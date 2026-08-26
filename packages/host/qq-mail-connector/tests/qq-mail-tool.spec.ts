/** Personal QQ Mail tool projection and approval behavior. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { QqMailConnectorGateway } from '../src/index.ts'
import type { QqMailConnectorEventSnapshot } from '../src/types.ts'
import * as ToolQqMail from '../src/tool.ts'

const contexts: Context[] = []
const SIGNAL = new AbortController().signal
const AGENT = { id: 'qq-mail-agent' as SessionId } as Agent

class FakeGateway {
  toolCallTimeoutMs = 321
  calls: Array<{ name: string; args: unknown[] }> = []
  private snapshot: QqMailConnectorEventSnapshot = {
    status: 'disconnected', toolCount: 0, errorCode: null, errorMessage: null,
    updatedAt: '2026-08-26T00:00:00.000Z',
  }
  constructor(private readonly ctx: Context) {}
  current(): QqMailConnectorEventSnapshot { return this.snapshot }
  connect(): void {
    this.snapshot = { ...this.snapshot, status: 'connected', toolCount: 4 }
    this.ctx.emit('qq-mail-connector/change', this.snapshot)
  }
  disconnect(): void {
    this.snapshot = { ...this.snapshot, status: 'disconnected', toolCount: 0 }
    this.ctx.emit('qq-mail-connector/change', this.snapshot)
  }
  listMessages(...args: unknown[]): Promise<JsonValue> { this.calls.push({ name: 'list', args }); return Promise.resolve([]) }
  searchMessages(...args: unknown[]): Promise<JsonValue> { this.calls.push({ name: 'search', args }); return Promise.resolve([]) }
  readMessage(...args: unknown[]): Promise<JsonValue> { this.calls.push({ name: 'read', args }); return Promise.resolve({ uid: 1 }) }
  sendMessage(...args: unknown[]): Promise<JsonValue> { this.calls.push({ name: 'send', args }); return Promise.resolve({ messageId: 'x' }) }
}

class FakeApproval {
  outcome: ApprovalOutcome = 'allowed-once'
  readonly calls: ApprovalRequest[] = []
  request(request: ApprovalRequest): Promise<ApprovalOutcome> { this.calls.push(request); return Promise.resolve(this.outcome) }
}

async function boot(): Promise<{ ctx: Context; gateway: FakeGateway; approval: FakeApproval; disposeApproval: () => void }> {
  const ctx = new Context()
  contexts.push(ctx)
  const approval = new FakeApproval()
  const disposeApproval = ctx.provide('approval', approval as unknown as ApprovalService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const gateway = new FakeGateway(ctx)
  ctx.provide('qqMailConnector', gateway as unknown as QqMailConnectorGateway)
  await ctx.plugin(ToolQqMail)
  return { ctx, gateway, approval, disposeApproval }
}

function execution(name: string, withAgent = true): ToolRunContext {
  return { name, callId: CallId(`call-${name}`), signal: SIGNAL, ...withAgent ? { agent: AGENT } : {} } as ToolRunContext
}

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('personal QQ Mail tools', () => {
  it('projects four domain tools only while connected', async () => {
    const { ctx, gateway } = await boot()
    expect(ctx.tools.schemas()).toEqual([])
    gateway.connect()
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'qq_mail_list', 'qq_mail_search', 'qq_mail_read', 'qq_mail_send',
    ])
    gateway.disconnect()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('approves and routes each domain operation', async () => {
    const { ctx, gateway, approval } = await boot()
    gateway.connect()
    await ctx.tools.get('qq_mail_list')!.execute({ limit: 5, unread_only: true }, execution('qq_mail_list'))
    await ctx.tools.get('qq_mail_search')!.execute({ query: 'report', limit: 3 }, execution('qq_mail_search'))
    await ctx.tools.get('qq_mail_read')!.execute({ uid: 7 }, execution('qq_mail_read'))
    await ctx.tools.get('qq_mail_send')!.execute({ to: ['a@example.com'], subject: 's', body: 'b' }, execution('qq_mail_send'))
    expect(gateway.calls.map(call => call.name)).toEqual(['list', 'search', 'read', 'send'])
    expect(approval.calls).toHaveLength(4)
    expect(approval.calls[0]).toMatchObject({ reason: ToolQqMail.QQ_MAIL_APPROVAL_REASON })
    await ctx.tools.get('qq_mail_list')!.execute({}, execution('qq_mail_list'))
    expect(gateway.calls.at(-1)?.args.slice(0, 2)).toEqual([10, false])
    for (const name of ['qq_mail_list', 'qq_mail_search', 'qq_mail_read', 'qq_mail_send']) {
      expect(ctx.tools.get(name)!.output.render({}, { rendered: name })).toEqual([
        { type: 'text', text: JSON.stringify({ rendered: name }, null, 2) },
      ])
    }
  })

  it('validates semantic bounds and fails closed on approval', async () => {
    const { ctx, gateway, approval, disposeApproval } = await boot()
    gateway.connect()
    const list = ctx.tools.get('qq_mail_list')!
    await expect(list.execute({ limit: 0 }, execution(list.name))).rejects.toThrow(/1 through 50/)
    await expect(list.execute({ limit: 1.5 }, execution(list.name))).rejects.toThrow(/1 through 50/)
    await expect(list.execute({ limit: 51 }, execution(list.name))).rejects.toThrow(/1 through 50/)
    const search = ctx.tools.get('qq_mail_search')!
    await expect(search.execute({ query: '   ' }, execution(search.name))).rejects.toThrow(/nonempty/)
    const read = ctx.tools.get('qq_mail_read')!
    await expect(read.execute({ uid: 0 }, execution(read.name))).rejects.toThrow(/positive integer/)
    await expect(read.execute({ uid: 1.5 }, execution(read.name))).rejects.toThrow(/positive integer/)
    const send = ctx.tools.get('qq_mail_send')!
    await expect(send.execute({ to: [], subject: 's', body: 'b' }, execution(send.name))).rejects.toThrow(/recipient/)
    await expect(send.execute({ to: ['  '], subject: 's', body: 'b' }, execution(send.name))).rejects.toThrow(/recipient/)
    approval.outcome = 'rejected'
    await expect(list.execute({}, execution(list.name))).rejects.toThrow(/user rejected/)
    approval.outcome = 'cancelled'
    await expect(list.execute({}, execution(list.name))).rejects.toThrow(/cancelled/)
    approval.outcome = 'unavailable'
    await expect(list.execute({}, execution(list.name))).rejects.toThrow(/no approval channel/)
    await expect(list.execute({}, execution(list.name, false))).rejects.toThrow(/no agent/)
    disposeApproval()
    await expect(list.execute({}, execution(list.name))).rejects.toThrow(/no approval service/)
    expect(gateway.calls).toEqual([])
  })

  it('removes the complete catalog when its scope disposes', async () => {
    const { ctx, gateway } = await boot()
    gateway.connect()
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.schemas()).toEqual([])
  })
})
