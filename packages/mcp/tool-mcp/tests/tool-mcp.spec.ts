import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import McpRuntime, {
  mcpServerName,
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
  type McpServerStatus,
  type McpToolDescriptor,
} from '@deepseek-ai/dsh-mcp'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import * as ToolMcp from '../src/index.ts'

const SERVER = mcpServerName('docs')
const SIGNAL = new AbortController().signal

function descriptor(
  name: string,
  options: Partial<McpToolDescriptor> = {},
): McpToolDescriptor {
  return {
    name,
    description: `MCP ${name}`,
    inputSchema: { type: 'object', properties: {} },
    ...options,
  }
}

class FakeMcpRuntime extends McpRuntime {
  calls: McpCallToolRequest[] = []
  result: McpResult = { content: [{ type: 'text', text: 'ok' }] }
  private state: McpRuntimeSnapshot = { revision: 0, servers: [] }

  override connect(_request: McpConnectRequest): Promise<McpServerSnapshot> {
    return Promise.reject(new Error('not implemented by fake'))
  }

  override disconnect(_serverName: McpServerName): Promise<void> {
    return Promise.resolve()
  }

  override snapshot(): McpRuntimeSnapshot {
    return this.state
  }

  override callTool(request: McpCallToolRequest): Promise<McpResult> {
    this.calls.push(request)
    return Promise.resolve(this.result)
  }

  commit(tools: readonly McpToolDescriptor[], status: McpServerStatus = 'connected'): void {
    this.state = {
      revision: this.state.revision + 1,
      servers: [{ serverName: SERVER, status, generation: 1, tools }],
    }
    this.notifyChange()
  }

  removeServer(): void {
    this.state = { revision: this.state.revision + 1, servers: [] }
    this.notifyChange()
  }

  reemit(): void {
    this.notifyChange()
  }
}

interface Harness {
  readonly ctx: Context
  readonly runtime: FakeMcpRuntime
  readonly scope: Scope
  readonly agent: Agent
  readonly approval: FakeApproval
  readonly disposeApproval: () => void
}

class FakeApproval {
  outcome: ApprovalOutcome = 'allowed-once'
  readonly calls: ApprovalRequest[] = []

  request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    this.calls.push(request)
    return Promise.resolve(this.outcome)
  }
}

async function boot(mountConsumer = true): Promise<Harness> {
  const ctx = new Context()
  const approval = new FakeApproval()
  const disposeApproval = ctx.provide('approval', approval as unknown as ApprovalService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeMcpRuntime)
  const agent = { id: 'agent-a' as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
    inject: ['mcp', 'tools', 'systemPrompt'],
  }))
  if (mountConsumer) await scope.ctx.plugin(ToolMcp, { toolCallTimeoutMs: 321 })
  return { ctx, runtime: ctx.mcp as FakeMcpRuntime, scope, agent, approval, disposeApproval }
}

function localTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve('local-ok'),
  }
}

async function execute(harness: Harness, name: string, args: unknown = {}) {
  return harness.ctx.tools.execute({
    callId: CallId(`call-${name}`),
    name,
    arguments: args,
    agent: harness.agent,
    signal: SIGNAL,
  })
}

function registeredDefinition(harness: Harness, name: string): ToolDefinition {
  const definition = harness.ctx.tools.get(name, harness.agent)
  if (definition === undefined) throw new Error(`missing test tool ${name}`)
  return definition
}

async function executeBody(harness: Harness, name: string, args: unknown = {}): Promise<unknown> {
  return registeredDefinition(harness, name).execute(args, {
    signal: SIGNAL,
    agent: harness.agent,
    name,
    callId: CallId(`body-${name}`),
  } as ToolRunContext)
}

describe('MCP catalog projection', () => {
  it('registers and removes tools only in the consumer preset scope', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'search')

    harness.runtime.commit([descriptor('search', { annotations: { readOnlyHint: true } })])
    harness.runtime.reemit()

    expect(harness.ctx.tools.schemas(harness.agent).map(tool => tool.name)).toEqual([publicName])
    expect(harness.ctx.tools.schemas()).toEqual([])
    const other = { id: 'agent-b' as SessionId } as Agent
    expect(harness.ctx.tools.schemas(other)).toEqual([])

    harness.runtime.commit([descriptor('search', { annotations: { readOnlyHint: true } })], 'reconnecting')
    expect(harness.ctx.tools.schemas(harness.agent).map(tool => tool.name)).toEqual([publicName])

    harness.runtime.removeServer()
    expect(harness.ctx.tools.schemas(harness.agent)).toEqual([])
  })

  it('uses the default timeout for direct construction and rejects invalid budgets', async () => {
    const harness = await boot(false)
    expect(() => ToolMcp.apply(harness.scope.ctx, { toolCallTimeoutMs: 0 })).toThrow(/positive integer/)
    expect(() => ToolMcp.apply(harness.scope.ctx, { toolCallTimeoutMs: 1.5 })).toThrow(/positive integer/)
    ToolMcp.apply(harness.scope.ctx, {})
    const publicName = ToolMcp.publicToolName(SERVER, 'read')
    harness.runtime.commit([descriptor('read', { annotations: { readOnlyHint: true } })])

    await executeBody(harness, publicName, 'invalid-object-arguments')

    expect(harness.runtime.calls[0]).toMatchObject({
      args: {},
      timeoutMs: ToolMcp.DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
    })
  })

  it('calls the current runtime with the raw name, arguments, signal, and configured timeout', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'read_doc')
    harness.runtime.commit([descriptor('read_doc', { annotations: { readOnlyHint: true } })])

    const result = await executeBody(harness, publicName, { id: 'doc-1' })

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(harness.runtime.calls).toEqual([{
      serverName: SERVER,
      name: 'read_doc',
      args: { id: 'doc-1' },
      signal: SIGNAL,
      timeoutMs: 321,
    }])
  })

  it('asks at the last mile for every MCP tool despite an earlier allow or read-only claim', async () => {
    const harness = await boot()
    const writeName = ToolMcp.publicToolName(SERVER, 'write_doc')
    const claimedReadName = ToolMcp.publicToolName(SERVER, 'read_doc')
    harness.runtime.commit([
      descriptor('write_doc'),
      descriptor('read_doc', { annotations: { readOnlyHint: true } }),
    ])
    harness.scope.ctx.tools.register(localTool('local'))
    harness.scope.ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }), { prepend: true })
    harness.approval.outcome = 'rejected'

    for (const name of [writeName, claimedReadName]) {
      const denied = await execute(harness, name)
      expect(denied).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: `Error: the user rejected tool "${name}"` }],
      })
    }
    expect(harness.runtime.calls).toEqual([])
    expect(harness.approval.calls).toEqual([
      expect.objectContaining({ toolName: writeName, reason: ToolMcp.MCP_TOOL_APPROVAL_REASON }),
      expect.objectContaining({ toolName: claimedReadName, reason: ToolMcp.MCP_TOOL_APPROVAL_REASON }),
    ])

    const local = await execute(harness, 'local')
    expect(local).toMatchObject({ isError: false, content: [{ type: 'text', text: 'local-ok' }] })
    expect(harness.approval.calls).toHaveLength(2)
  })

  it('fails closed for cancelled, unavailable, missing, and unroutable approval', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'read_doc')
    harness.runtime.commit([descriptor('read_doc')])

    harness.approval.outcome = 'cancelled'
    await expect(executeBody(harness, publicName)).rejects.toThrow(`approval for tool "${publicName}" was cancelled`)
    harness.approval.outcome = 'unavailable'
    await expect(executeBody(harness, publicName)).rejects.toThrow(/no approval channel is available/)

    await expect(registeredDefinition(harness, publicName).execute({}, {
      signal: SIGNAL,
      name: publicName,
      callId: CallId('agent-less'),
    } as ToolRunContext)).rejects.toThrow(/no agent to route it through/)

    harness.disposeApproval()
    await expect(executeBody(harness, publicName)).rejects.toThrow(/no approval service is available/)
    expect(harness.runtime.calls).toEqual([])
  })

  it('rejects task-required tools before calling the runtime', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'async_only')
    harness.runtime.commit([descriptor('async_only', {
      taskSupport: 'required',
      annotations: { readOnlyHint: true },
    })])

    await expect(executeBody(harness, publicName)).rejects.toThrow(/requires task-based execution/)
    expect(harness.runtime.calls).toEqual([])
  })

  it('preserves structured JSON and maps an MCP error into the tool failure path', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'structured')
    harness.runtime.commit([descriptor('structured', {
      outputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    })])
    harness.runtime.result = {
      content: [{ type: 'text', text: 'structured-ok' }],
      structuredContent: { value: 'kept' },
    }

    const success = await executeBody(harness, publicName)
    expect(success).toEqual({
      content: [{ type: 'text', text: 'structured-ok' }],
      structuredContent: { value: 'kept' },
    })
    expect(registeredDefinition(harness, publicName).output.render({}, success as JsonValue)).toEqual([
      { type: 'text', text: 'structured-ok' },
    ])

    harness.runtime.result = { content: [{ type: 'text', text: 'server refused' }], isError: true }
    await expect(executeBody(harness, publicName)).rejects.toThrow('server refused')
  })

  it('keeps the prior catalog when a new input schema cannot be represented', async () => {
    const harness = await boot()
    const original = ToolMcp.publicToolName(SERVER, 'search')
    harness.runtime.commit([descriptor('search', { annotations: { readOnlyHint: true } })])

    harness.runtime.commit([descriptor('broken', { inputSchema: { type: 'string' } })])

    expect(harness.ctx.tools.schemas(harness.agent).map(tool => tool.name)).toEqual([original])
  })

  it('keeps the prior catalog for duplicate names and ignores a replayed revision', async () => {
    const harness = await boot()
    const original = ToolMcp.publicToolName(SERVER, 'search')
    harness.runtime.commit([descriptor('search', { annotations: { readOnlyHint: true } })])

    harness.runtime.commit([descriptor('duplicate'), descriptor('duplicate')])
    harness.runtime.reemit()

    expect(harness.ctx.tools.schemas(harness.agent).map(tool => tool.name)).toEqual([original])
  })

  it('rolls back a partial generation when a scoped name is already occupied', async () => {
    const harness = await boot()
    const first = ToolMcp.publicToolName(SERVER, 'a')
    const occupied = ToolMcp.publicToolName(SERVER, 'z')
    harness.scope.ctx.tools.register({ ...localTool(occupied), description: 'foreign' })

    harness.runtime.commit([descriptor('z'), descriptor('a')])

    expect(harness.ctx.tools.get(first, harness.agent)).toBeUndefined()
    expect(harness.ctx.tools.get(occupied, harness.agent)?.description).toBe('foreign')
  })

  it('registers catalog entries in deterministic public-name order and removes them on scope disposal', async () => {
    const harness = await boot()
    harness.runtime.commit([
      descriptor('z', { annotations: { readOnlyHint: true } }),
      descriptor('a', { annotations: { readOnlyHint: true } }),
      descriptor('m', { annotations: { readOnlyHint: true } }),
    ])
    const expected = ['a', 'm', 'z'].map(raw => ToolMcp.publicToolName(SERVER, raw))
    expect(harness.ctx.tools.schemas(harness.agent).map(tool => tool.name)).toEqual(expected)

    await harness.scope.dispose()
    expect(harness.ctx.tools.schemas(harness.agent)).toEqual([])
  })

  it('falls back to an unconstrained structured result for unsupported output schema vocabulary', async () => {
    const harness = await boot()
    const publicName = ToolMcp.publicToolName(SERVER, 'legacy')
    harness.runtime.commit([descriptor('legacy', {
      outputSchema: { type: 'object', patternProperties: { '.*': { type: 'string' } } },
      annotations: { readOnlyHint: true },
    })])

    const result = await executeBody(harness, publicName)
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })
})

describe('MCP projections', () => {
  it('normalizes lossy names with a stable identity suffix', () => {
    const first = ToolMcp.publicToolName(SERVER, 'admin.reset')
    const second = ToolMcp.publicToolName(SERVER, 'admin_reset')
    expect(first).toMatch(/^mcp__docs__admin_reset_[0-9a-f]{12}$/)
    expect(first).not.toBe(second)
    expect(ToolMcp.publicToolName(SERVER, 'admin.reset')).toBe(first)
  })

  it('renders text and compact placeholders without binary payloads', () => {
    expect(ToolMcp.extractMcpText([
      { type: 'text', text: 'hello' },
      { type: 'image', mimeType: 'image/png', data: 'secret-bytes' },
      { type: 'resource', uri: 'file:///secret' },
    ], 'read')).toBe('hello\n[image: image/png, content discarded]\n[resource: content discarded]')
  })

  it('covers malformed, audio, unknown, and empty content fallbacks', () => {
    expect(ToolMcp.extractMcpText([
      null,
      1,
      [],
      { type: 'text' },
      { type: 'image' },
      { type: 'audio', mimeType: 'audio/wav' },
      { type: 'audio' },
      { type: 'video' },
    ], 'mixed')).toBe([
      '[unsupported content type: unknown]',
      '[unsupported content type: unknown]',
      '[unsupported content type: unknown]',
      '[image: unknown, content discarded]',
      '[audio: audio/wav, content discarded]',
      '[audio: unknown, content discarded]',
      '[unsupported content type: video]',
    ].join('\n'))
    expect(ToolMcp.extractMcpText([], 'empty')).toBe('(empty returned no text content)')
  })

  it('truncates overlong identities to the function-name limit', () => {
    const name = ToolMcp.publicToolName(SERVER, 'x'.repeat(100))
    expect(name).toHaveLength(64)
    expect(name).toMatch(/_[0-9a-f]{12}$/)
  })
})
