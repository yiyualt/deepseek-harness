/**
 * Client-safe types for the MCP runtime seam. This module contains no runtime
 * code and never exposes transport clients or resolved credential values.
 *
 * @module @deepseek-ai/dsh-mcp/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Stable, opaque identity of one configured MCP server connection. */
export type McpServerName = Branded<'McpServerName'>

/** Lifecycle state of a server that is still present in the runtime snapshot. */
export type McpServerStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnecting'

/** Credential reference used as an HTTP `Authorization` header value. */
export interface McpCredentialAuthorizationConfig {
  /** Selects credential-reference resolution. */
  readonly kind: 'credential'
  /** Reference resolved through `ctx.credentials` for each HTTP request. */
  readonly ref: CredentialRef
  /** Send the resolved value verbatim; this mode never prepends `Bearer `. */
  readonly scheme: 'raw'
}

/** Extensible authorization configuration for an MCP transport. */
export type McpAuthorizationConfig = McpCredentialAuthorizationConfig

/** Child-process transport configuration for one MCP server. */
export interface McpStdioTransportConfig {
  /** Selects a child process connected through stdin/stdout. */
  readonly kind: 'stdio'
  /** Executable invoked directly, without shell interpolation. */
  readonly command: string
  /** Arguments passed directly to the executable. */
  readonly args?: readonly string[]
  /** Additional process environment entries. */
  readonly env?: Readonly<Record<string, string>>
  /** Child-process working directory. */
  readonly cwd?: string
}

/** Streamable HTTP transport configuration for one MCP server. */
export interface McpStreamableHttpTransportConfig {
  /** Selects MCP Streamable HTTP. */
  readonly kind: 'streamable-http'
  /** Absolute MCP endpoint URL. */
  readonly url: string
  /** Non-authorization HTTP headers; providers reject `Authorization` here. */
  readonly headers?: Readonly<Record<string, string>>
  /** Optional credential-backed `Authorization` value. */
  readonly authorization?: McpAuthorizationConfig
}

/** Supported MCP client transports. */
export type McpTransportConfig = McpStdioTransportConfig | McpStreamableHttpTransportConfig

/** Request to establish one named MCP connection. */
export interface McpConnectRequest {
  /** Unique connection identity. */
  readonly serverName: McpServerName
  /** Transport used for this connection and every reconnect generation. */
  readonly transport: McpTransportConfig
}

/** MCP task-execution support advertised for one tool. */
export type McpTaskSupport = 'forbidden' | 'optional' | 'required'

/** Standard MCP safety annotations retained from a server tool descriptor. */
export interface McpToolAnnotations {
  /** Server-provided hint that the tool does not modify its environment; not an authorization grant. */
  readonly readOnlyHint?: boolean
  /** Server-provided hint that the tool may perform destructive updates. */
  readonly destructiveHint?: boolean
  /** Server-provided hint that repeated calls with the same arguments have no additional effect. */
  readonly idempotentHint?: boolean
  /** Server-provided hint that the tool may interact with entities outside a closed local domain. */
  readonly openWorldHint?: boolean
}

/** One tool advertised by the current generation of an MCP connection. */
export interface McpToolDescriptor {
  /** Raw MCP name sent in `tools/call`. */
  readonly name: string
  /** Server-provided model-facing description. */
  readonly description: string
  /** Server-provided input JSON Schema. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** Optional server-provided output JSON Schema. */
  readonly outputSchema?: Readonly<Record<string, unknown>>
  /** Server-declared task-execution support. */
  readonly taskSupport?: McpTaskSupport
  /** Untrusted server-declared safety hints retained for information and audit. */
  readonly annotations?: McpToolAnnotations
}

/** Safe public state for one MCP server that has not finished disconnecting. */
export interface McpServerSnapshot {
  /** Stable connection identity. */
  readonly serverName: McpServerName
  /** Current connection lifecycle state. */
  readonly status: McpServerStatus
  /** Monotonic transport generation for this connection. */
  readonly generation: number
  /**
   * Last successfully advertised catalog. It may remain during `reconnecting`
   * for schema stability, but {@link McpRuntime.callTool} rejects until the
   * server returns to `connected`.
   */
  readonly tools: readonly McpToolDescriptor[]
  /** Provider-defined safe failure code, absent outside a reported failure. */
  readonly errorCode?: string
  /** Safe diagnostic message that never contains headers or credential values. */
  readonly errorMessage?: string
}

/** Full safe state of the MCP connection registry. */
export interface McpRuntimeSnapshot {
  /** Monotonic registry revision changed before every `mcp/change` emission. */
  readonly revision: number
  /** Every live, failed, or disconnecting connection; fully disconnected names are absent. */
  readonly servers: readonly McpServerSnapshot[]
}

/** Request to invoke a tool on the runtime's current connection generation. */
export interface McpCallToolRequest {
  /** Connection whose current generation receives the call. */
  readonly serverName: McpServerName
  /** Raw MCP tool name. */
  readonly name: string
  /** JSON arguments sent in `tools/call`. */
  readonly args: Readonly<Record<string, JsonValue>>
  /** Caller cancellation propagated to the transport. */
  readonly signal: AbortSignal
  /** Timeout for this invocation in milliseconds. */
  readonly timeoutMs: number
}

/** Canonical JSON result returned by an MCP tool call. */
export interface McpResult {
  /** Lossless MCP content blocks. */
  readonly content: readonly JsonValue[]
  /** Optional structured result advertised by the tool. */
  readonly structuredContent?: JsonValue
  /** Whether the MCP server reported a tool-level failure. */
  readonly isError?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Complete safe MCP registry snapshot after a connection status or catalog
     * commit. Listener failures are contained by the emitting runtime, except
     * synchronous `INVARIANT` failures, which rethrow after every listener ran.
     * This is an unfiltered registry notification rather than an agent event.
     * @param snapshot - complete state at the committed revision.
     * @mode emit
     */
    'mcp/change'(snapshot: McpRuntimeSnapshot): void
  }
}
