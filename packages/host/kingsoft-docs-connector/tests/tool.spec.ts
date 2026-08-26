import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  KdocsCliActionRequest,
  KdocsCliService,
  KingsoftDocsConnectorGateway,
} from '../src/index.ts'
import type { KingsoftDocsConnectorSnapshot } from '../src/types.ts'
import * as ToolKingsoftDocs from '../src/tool.ts'

const contexts: Context[] = []
const SIGNAL = new AbortController().signal
const AGENT = { id: 'kingsoft-agent' as SessionId } as Agent

class FakeGateway {
  toolCallTimeoutMs = 321
  helpCalls: Array<{ service: KdocsCliService | undefined; action: string | undefined }> = []
  actionCalls: KdocsCliActionRequest[] = []
  private snapshot: KingsoftDocsConnectorSnapshot = {
    status: 'disconnected',
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: '2026-08-26T00:00:00.000Z',
  }

  constructor(private readonly ctx: Context) {}

  current(): KingsoftDocsConnectorSnapshot {
    return this.snapshot
  }

  connect(): void {
    this.snapshot = { ...this.snapshot, status: 'connected', toolCount: 2 }
    this.ctx.emit('kingsoft-docs-connector/change', this.snapshot)
  }

  disconnect(): void {
    this.snapshot = { ...this.snapshot, status: 'disconnected', toolCount: 0 }
    this.ctx.emit('kingsoft-docs-connector/change', this.snapshot)
  }

  runHelp(service: KdocsCliService | undefined, action: string | undefined): Promise<string> {
    this.helpCalls.push({ service, action })
    return Promise.resolve('help output')
  }

  runAction(request: KdocsCliActionRequest): Promise<JsonValue> {
    this.actionCalls.push(request)
    return Promise.resolve({ code: 0, data: { ok: true } })
  }
}

class FakeApproval {
  outcome: ApprovalOutcome = 'allowed-once'
  readonly calls: ApprovalRequest[] = []

  request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    this.calls.push(request)
    return Promise.resolve(this.outcome)
  }
}

async function boot(withApproval = true): Promise<{
  readonly ctx: Context
  readonly gateway: FakeGateway
  readonly approval: FakeApproval
  readonly disposeApproval: () => void
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const approval = new FakeApproval()
  const disposeApproval = withApproval
    ? ctx.provide('approval', approval as unknown as ApprovalService)
    : () => {}
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const gateway = new FakeGateway(ctx)
  ctx.provide('kingsoftDocsConnector', gateway as unknown as KingsoftDocsConnectorGateway)
  await ctx.plugin(ToolKingsoftDocs)
  return { ctx, gateway, approval, disposeApproval }
}

function execution(name: string, withAgent = true): ToolRunContext {
  return {
    name,
    callId: CallId(`call-${name}`),
    signal: SIGNAL,
    ...withAgent ? { agent: AGENT } : {},
  } as ToolRunContext
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Kingsoft Docs scoped tools', () => {
  it('projects exactly two tools only while browser login is connected', async () => {
    const { ctx, gateway } = await boot()
    expect(ctx.tools.schemas()).toEqual([])

    gateway.connect()
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'kingsoft_docs_help',
      'kingsoft_docs_call',
    ])
    expect(ctx.tools.get('kingsoft_docs_call')?.timeoutMs).toBe(321)

    gateway.disconnect()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('uses help without approval and forwards current service and action', async () => {
    const { ctx, gateway, approval } = await boot()
    gateway.connect()
    const help = ctx.tools.get('kingsoft_docs_help')!

    await expect(help.execute({ service: 'drive', action: 'list-files' }, execution(help.name)))
      .resolves.toBe('help output')
    await expect(help.execute({}, execution(help.name))).resolves.toBe('help output')
    expect(gateway.helpCalls).toEqual([
      { service: 'drive', action: 'list-files' },
      { service: undefined, action: undefined },
    ])
    expect(help.output?.render?.({}, 'help output')).toEqual([{ type: 'text', text: 'help output' }])
    expect(approval.calls).toEqual([])
    await expect(help.execute({ action: 'bad action' }, execution(help.name))).rejects.toThrow(/kebab-case/)
    await expect(help.execute({ service: 'unknown' }, execution(help.name))).rejects.toThrow(/invalid arguments/)
  })

  it('asks immediately before forwarding one JSON action', async () => {
    const { ctx, gateway, approval } = await boot()
    gateway.connect()
    const call = ctx.tools.get('kingsoft_docs_call')!
    const exec = execution(call.name)

    await expect(call.execute({
      service: 'drive',
      action: 'list-files',
      params: { parent_id: 'root' },
    }, exec)).resolves.toEqual({ code: 0, data: { ok: true } })

    expect(approval.calls).toEqual([expect.objectContaining({
      toolName: 'kingsoft_docs_call',
      callId: exec.callId,
      reason: ToolKingsoftDocs.KINGSOFT_DOCS_APPROVAL_REASON,
    })])
    expect(gateway.actionCalls).toEqual([expect.objectContaining({
      service: 'drive',
      action: 'list-files',
      params: { parent_id: 'root' },
      signal: SIGNAL,
    })])
    expect(call.output?.render?.({}, { code: 0 })).toEqual([
      { type: 'text', text: '{\n  "code": 0\n}' },
    ])
  })

  it('fails closed for rejected, cancelled, unavailable, unroutable, and missing approval', async () => {
    const { ctx, gateway, approval, disposeApproval } = await boot()
    gateway.connect()
    const call = ctx.tools.get('kingsoft_docs_call')!
    const args = { service: 'drive', action: 'list-files', params: {} }

    approval.outcome = 'rejected'
    await expect(call.execute(args, execution(call.name))).rejects.toThrow(/user rejected/)
    approval.outcome = 'cancelled'
    await expect(call.execute(args, execution(call.name))).rejects.toThrow(/was cancelled/)
    approval.outcome = 'unavailable'
    await expect(call.execute(args, execution(call.name))).rejects.toThrow(/no approval channel/)
    await expect(call.execute(args, execution(call.name, false))).rejects.toThrow(/no agent/)
    disposeApproval()
    await expect(call.execute(args, execution(call.name))).rejects.toThrow(/no approval service/)
    expect(gateway.actionCalls).toEqual([])
  })

  it('validates service, action, and object parameters before approval', async () => {
    const { ctx, gateway, approval } = await boot()
    gateway.connect()
    const call = ctx.tools.get('kingsoft_docs_call')!

    await expect(call.execute({ service: 'nope', action: 'list-files', params: {} }, execution(call.name)))
      .rejects.toThrow(/invalid arguments/)
    await expect(call.execute({ service: 'drive', action: 'bad action', params: {} }, execution(call.name)))
      .rejects.toThrow(/kebab-case/)
    await expect(call.execute({ service: 'drive', action: 'list-files', params: 'nope' }, execution(call.name)))
      .rejects.toThrow(/invalid arguments/)
    expect(approval.calls).toEqual([])
  })

  it('keeps one catalog while connected and disposes it with the plugin scope', async () => {
    const { ctx, gateway } = await boot()
    gateway.connect()
    gateway.connect()
    expect(ctx.tools.schemas()).toHaveLength(2)

    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.schemas()).toEqual([])
  })
})
