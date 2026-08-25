/**
 * Scoped MCP tool consumer. It projects the safe `ctx.mcp` catalog into
 * `ctx.tools`, dispatches through the runtime's current transport generation,
 * and asks for approval before every MCP tool call. Server annotations remain
 * informational and never grant execution authority.
 *
 * @module @deepseek-ai/dsh-tool-mcp
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  McpResult,
  McpRuntimeSnapshot,
  McpServerName,
  McpToolDescriptor,
} from '@deepseek-ai/dsh-mcp'
import type { JsonValue, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { assertObjectJsonSchema, assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-mcp'

/** Services required by the scoped MCP tool consumer. */
export const inject = ['mcp', 'tools']

/** Default timeout for one MCP `tools/call` request. */
export const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 60_000

/** Plugin configuration for MCP tool execution. */
export interface Config {
  /** Per-call transport timeout in milliseconds. Defaults to 60000. */
  toolCallTimeoutMs?: number
}

/** Loader schema for {@link Config}. */
export const Config: z<Config> = z.object({
  toolCallTimeoutMs: z.number().default(DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS),
})

/** DeepSeek function-name limit. */
const MAX_PUBLIC_NAME_LENGTH = 64

/** Characters outside the DeepSeek function-name vocabulary. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** SHA-256 suffix length used after lossy name normalization. */
const HASH_LENGTH = 12

/** Confirmation reason for every executable MCP tool. */
export const MCP_TOOL_APPROVAL_REASON = 'MCP tool may change external data'

/** Require one audited approval immediately before an MCP transport call. */
async function requireMcpApproval(ctx: Context, exec: ToolRunContext): Promise<void> {
  const approval = ctx.get('approval')
  if (approval === undefined) {
    throw new Error(`tool "${exec.name}" requires approval, but no approval service is available`)
  }
  if (exec.agent === undefined) {
    throw new Error(`tool "${exec.name}" requires approval, but the call has no agent to route it through`)
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason: MCP_TOOL_APPROVAL_REASON,
    signal: exec.signal,
  })
  switch (outcome) {
    case 'allowed-once': return
    case 'rejected': throw new Error(`the user rejected tool "${exec.name}"`)
    case 'cancelled': throw new Error(`approval for tool "${exec.name}" was cancelled`)
    case 'unavailable': throw new Error(`tool "${exec.name}" requires approval, but no approval channel is available`)
  }
}

/** One prepared registration before the old catalog is removed. */
interface PreparedTool {
  readonly publicName: string
  readonly serverName: McpServerName
  readonly descriptor: McpToolDescriptor
  readonly definition: ToolDefinition
}

/** Runtime state owned by one scoped plugin instance. */
interface ToolCatalogState {
  revision: number
  names: Set<string>
  disposers: Map<string, () => void>
}

/**
 * Derive the model-facing name for one MCP tool identity.
 *
 * Clean names use `mcp__<serverName>__<rawName>`. Replacement or truncation
 * appends a deterministic 12-character SHA-256 suffix so lossy normalization
 * does not collapse distinct identities.
 * @param serverName - stable opaque MCP connection name.
 * @param rawName - server-provided tool name.
 * @returns deterministic name accepted by the harness tool registry.
 */
export function publicToolName(serverName: McpServerName | string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** Validate a direct-construction timeout after loader defaults are resolved. */
function resolveToolCallTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('tool-mcp: toolCallTimeoutMs must be a positive integer')
  }
  return timeoutMs
}

/** MCP content fields read by the Native text projection. */
interface McpContentBlock {
  readonly type: string
  readonly text?: string
  readonly mimeType?: string
}

/**
 * Project lossless MCP content into one model-visible text result.
 * @param content - canonical MCP content blocks.
 * @param rawName - raw tool name used by the empty-result diagnostic.
 * @returns joined text and compact placeholders for non-text blocks.
 */
export function extractMcpText(content: readonly JsonValue[], rawName: string): string {
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) parts.push(block.text)
        break
      case 'image':
        parts.push(`[image: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'audio':
        parts.push(`[audio: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource: content discarded]')
        break
      default:
        parts.push(`[unsupported content type: ${block.type}]`)
    }
  }
  return parts.join('\n') || `(${rawName} returned no text content)`
}

/** Keep a supported advertised output schema; unsupported vocabulary remains unconstrained. */
function supportedOutputSchema(candidate: unknown) {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/** Build the canonical MCP output declaration and Native text projection. */
function createOutput(rawName: string, outputSchema: unknown): ToolDefinition['output'] {
  const structuredSchema = supportedOutputSchema(outputSchema)
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args, value) {
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractMcpText(result.content, rawName) }]
    },
  }
}

/** Convert model arguments to the object accepted by MCP `tools/call`. */
function objectArguments(args: unknown): Record<string, JsonValue> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return {}
  return args as Record<string, JsonValue>
}

/** Create an executor that resolves the runtime's current connection generation at call time. */
function createExecutor(
  ctx: Context,
  serverName: McpServerName,
  descriptor: McpToolDescriptor,
  timeoutMs: number,
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolRunContext) => {
    if (descriptor.taskSupport === 'required') {
      throw new Error(`Tool "${descriptor.name}" requires task-based execution, which this bridge does not support`)
    }
    await requireMcpApproval(ctx, exec)
    const result = await ctx.mcp.callTool({
      serverName,
      name: descriptor.name,
      args: objectArguments(args),
      signal: exec.signal,
      timeoutMs,
    })
    const detached = {
      content: [...result.content],
      ...result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {},
    }
    if (result.isError === true) throw new Error(extractMcpText(detached.content, descriptor.name))
    return detached
  }
}

/** Build and validate the complete next tool generation without changing registrations. */
function prepareCatalog(ctx: Context, snapshot: McpRuntimeSnapshot, timeoutMs: number): PreparedTool[] {
  const prepared = new Map<string, PreparedTool>()
  for (const server of snapshot.servers) {
    for (const descriptor of server.tools) {
      const publicName = publicToolName(server.serverName, descriptor.name)
      if (prepared.has(publicName)) {
        throw new Error(`tool-mcp: MCP catalog contains duplicate public tool name "${publicName}"`)
      }
      const parameters: unknown = descriptor.inputSchema
      assertObjectJsonSchema(parameters)
      prepared.set(publicName, {
        publicName,
        serverName: server.serverName,
        descriptor,
        definition: {
          name: publicName,
          description: descriptor.description,
          parameters: parameters as unknown as Record<string, unknown>,
          output: createOutput(descriptor.name, descriptor.outputSchema),
          timeoutMs,
          execute: createExecutor(ctx, server.serverName, descriptor, timeoutMs),
        },
      })
    }
  }
  return [...prepared.values()].sort((left, right) => left.publicName.localeCompare(right.publicName))
}

/** Remove every registration from one catalog generation. */
function clearCatalog(state: ToolCatalogState): void {
  for (const dispose of state.disposers.values()) dispose()
  state.disposers.clear()
  state.names.clear()
}

/** Prepare then replace one complete scoped catalog generation. */
function reconcileCatalog(
  ctx: Context,
  snapshot: McpRuntimeSnapshot,
  timeoutMs: number,
  state: ToolCatalogState,
): void {
  if (snapshot.revision <= state.revision) return
  const prepared = prepareCatalog(ctx, snapshot, timeoutMs)
  clearCatalog(state)
  const nextNames = new Set<string>()
  const nextDisposers = new Map<string, () => void>()
  try {
    for (const tool of prepared) {
      nextDisposers.set(tool.publicName, ctx.tools.register(tool.definition))
      nextNames.add(tool.publicName)
    }
  } catch (error) {
    for (const dispose of nextDisposers.values()) dispose()
    state.revision = snapshot.revision
    throw error
  }
  state.names = nextNames
  state.disposers = nextDisposers
  state.revision = snapshot.revision
}

/**
 * Project the dynamic MCP catalog into the calling preset scope.
 * @param ctx - scoped plugin context carrying MCP and tool runtimes.
 * @param config - per-call timeout configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const timeoutMs = resolveToolCallTimeoutMs(config.toolCallTimeoutMs)
  const state: ToolCatalogState = {
    revision: -1,
    names: new Set(),
    disposers: new Map(),
  }

  ctx.effect(() => () => { clearCatalog(state) }, 'tool-mcp.catalog')
  reconcileCatalog(ctx, ctx.mcp.snapshot(), timeoutMs, state)

  ctx.on('mcp/change', (snapshot) => {
    try {
      reconcileCatalog(ctx, snapshot, timeoutMs, state)
    } catch (error) {
      ctx.logger.error(error)
    }
  })

}
