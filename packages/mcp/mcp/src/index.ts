/**
 * Service Definition for dynamic Model Context Protocol connections. Providers
 * own transport clients, reconnect generations, credentials, and safe status;
 * consumers observe descriptors and invoke tools only through `ctx.mcp`.
 *
 * @module @deepseek-ai/dsh-mcp
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  McpCallToolRequest,
  McpConnectRequest,
  McpResult,
  McpRuntimeSnapshot,
  McpServerName,
  McpServerSnapshot,
} from './types.ts'

export type {
  McpActivationCheck,
  McpActivationCheckOutcome,
  McpAuthorizationConfig,
  McpCallToolRequest,
  McpConnectRequest,
  McpCredentialAuthorizationConfig,
  McpResult,
  McpRuntimeSnapshot,
  McpServerName,
  McpServerSnapshot,
  McpServerStatus,
  McpStdioTransportConfig,
  McpStreamableHttpTransportConfig,
  McpTaskSupport,
  McpToolAnnotations,
  McpToolDescriptor,
  McpTransportConfig,
} from './types.ts'

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Validate and brand one stable MCP connection name.
 * @param value - candidate containing one to 32 ASCII letters, digits, `_`, or `-`.
 * @returns the opaque server name accepted by MCP runtime methods.
 */
export function mcpServerName(value: string): McpServerName {
  if (!SERVER_NAME_PATTERN.test(value)) {
    throw new TypeError(`MCP server name "${value}" must match ${String(SERVER_NAME_PATTERN)}`)
  }
  return value as McpServerName
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcp: McpRuntime
  }
}

/**
 * Abstract runtime for a dynamic registry of MCP server connections.
 * Providers mutate their state before calling {@link notifyChange}; snapshots
 * and diagnostics must never contain resolved credential values.
 */
export abstract class McpRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'mcp')
  }

  /**
   * Start one connection and resolve after its initial attempt commits a
   * snapshot. A name still present in {@link snapshot}, including a failed or
   * disconnecting connection, is a duplicate and must be rejected. Retrying or
   * replacing a connection is therefore an explicit `disconnect` then
   * `connect` sequence.
   * @param request - stable name and transport configuration.
   * @returns the committed initial server state.
   */
  abstract connect(request: McpConnectRequest): Promise<McpServerSnapshot>

  /**
   * Remove one connection. Providers first publish `disconnecting` with an
   * empty tool catalog, close listeners, abort owned work, await transport
   * quiescence, then remove the server from the next snapshot. An unknown name
   * is a no-op.
   * @param serverName - connection to remove.
   * @returns completion after the connection is absent and owned work is quiescent.
   */
  abstract disconnect(serverName: McpServerName): Promise<void>

  /**
   * Read the complete safe registry state synchronously.
   * @returns the current immutable snapshot.
   */
  abstract snapshot(): McpRuntimeSnapshot

  /**
   * Invoke a raw MCP tool on the named connection's current generation. The
   * implementation propagates cancellation, enforces the per-call timeout,
   * and rejects when no connected generation currently advertises the name.
   * @param request - connection, raw name, JSON arguments, signal, and timeout.
   * @returns the canonical MCP tool result.
   */
  abstract callTool(request: McpCallToolRequest): Promise<McpResult>

  /* jscpd:ignore-start -- deliberate symmetry with credential commit events:
     this seam has the same contained listener lifecycle but a distinct payload. */
  /**
   * Emit the current snapshot after a provider commits one lifecycle or
   * catalog change. Every listener runs; ordinary sync throws and async
   * rejections are logged, while a synchronous `INVARIANT` failure rethrows
   * after fan-out finishes.
   */
  protected notifyChange(): void {
    const snapshot = this.snapshot()
    let invariantFailure: unknown
    const args = ['mcp/change', snapshot]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(snapshot)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnListenerFailure(error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnListenerFailure(error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }
  /* jscpd:ignore-end */

  /** Log one contained observer failure without serializing its event payload. */
  private warnListenerFailure(error: unknown): void {
    this.ctx.logger.warn('mcp: an mcp/change listener failed')
    this.ctx.logger.warn(error)
  }
}

export default McpRuntime
