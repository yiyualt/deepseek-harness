import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import {
  McpRuntime,
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
  type McpServerStatus,
  type McpToolDescriptor,
} from '@deepseek-ai/dsh-mcp'
import TencentDocsConnectorGateway, {
  TENCENT_DOCS_MCP_CREDENTIAL_REF,
  TENCENT_DOCS_MCP_ENDPOINT,
  TENCENT_DOCS_MCP_SERVER_NAME,
} from '../src/index.ts'
import type { TencentDocsConnectorEventSnapshot } from '../src/types.ts'

const SECRET = 'space-mcp-token-never-export'

class MemoryCredentials extends CredentialProvider {
  value: string | undefined
  source: string | undefined = 'memory'
  writable = true
  describeError: unknown
  resolveError: unknown
  describeGate: PromiseWithResolvers<void> | undefined
  describeCalls = 0
  resolveCalls = 0

  constructor(ctx: Context, value?: string) {
    super(ctx)
    this.value = value
  }

  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolveCalls += 1
    if (this.resolveError !== undefined) return Promise.reject(this.resolveError)
    return Promise.resolve(this.value === undefined
      ? undefined
      : { value: this.value, source: this.source ?? 'memory-secret-source' })
  }

  override async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    this.describeCalls += 1
    if (this.describeGate !== undefined) {
      const gate = this.describeGate
      this.describeGate = undefined
      await gate.promise
    }
    if (this.describeError !== undefined) throw this.describeError
    return {
      configured: this.value !== undefined,
      ...this.value === undefined || this.source === undefined ? {} : { source: this.source },
      writable: this.writable,
    }
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.value = value
    this.notifyUpdated(ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    this.value = undefined
    this.notifyUpdated(ref)
    return Promise.resolve()
  }

  announce(ref: CredentialRef): void {
    this.notifyUpdated(ref)
  }
}

const TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'search_docs',
    description: 'Search Tencent Docs',
    inputSchema: { type: 'object' },
  },
  {
    name: 'read_doc',
    description: 'Read one Tencent Doc',
    inputSchema: { type: 'object' },
  },
]

function server(
  status: McpServerStatus,
  options: { tools?: readonly McpToolDescriptor[]; errorCode?: string; errorMessage?: string } = {},
): McpServerSnapshot {
  return {
    serverName: TENCENT_DOCS_MCP_SERVER_NAME,
    status,
    generation: 1,
    tools: options.tools ?? [],
    ...options.errorCode === undefined ? {} : { errorCode: options.errorCode },
    ...options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage },
  }
}

class FakeMcpRuntime extends McpRuntime {
  connects: McpConnectRequest[] = []
  disconnects: McpServerName[] = []
  history: string[] = []
  connectError: unknown
  connectErrorCode: string | undefined
  connectErrorMessage: string | undefined
  disconnectError: unknown
  connectGate: PromiseWithResolvers<McpServerSnapshot> | undefined
  disconnectGate: PromiseWithResolvers<void> | undefined
  snapshotError: unknown
  private state: McpRuntimeSnapshot = { revision: 0, servers: [] }

  override async connect(request: McpConnectRequest): Promise<McpServerSnapshot> {
    if (this.state.servers.some(entry => entry.serverName === request.serverName)) {
      throw new Error('duplicate MCP server')
    }
    this.connects.push(request)
    this.history.push(`connect:${request.serverName}`)
    this.commit(server('connecting'))
    if (this.connectGate !== undefined) {
      const gate = this.connectGate
      this.connectGate = undefined
      const connected = await gate.promise
      this.commit(connected)
      return connected
    }
    if (this.connectError !== undefined) {
      this.commit(server('failed', {
        ...this.connectErrorCode === undefined ? {} : { errorCode: this.connectErrorCode },
        ...this.connectErrorMessage === undefined ? {} : { errorMessage: this.connectErrorMessage },
      }))
      throw this.connectError
    }
    const connected = server('connected', { tools: TOOLS })
    this.commit(connected)
    return connected
  }

  override async disconnect(serverName: McpServerName): Promise<void> {
    const existing = this.state.servers.find(entry => entry.serverName === serverName)
    if (existing === undefined) return
    this.disconnects.push(serverName)
    this.history.push(`disconnect:${serverName}`)
    this.commit({ ...existing, status: 'disconnecting', tools: [] })
    if (this.disconnectError !== undefined) throw this.disconnectError
    if (this.disconnectGate !== undefined) {
      const gate = this.disconnectGate
      this.disconnectGate = undefined
      await gate.promise
    }
    this.commit(undefined)
  }

  override snapshot(): McpRuntimeSnapshot {
    if (this.snapshotError !== undefined) throw this.snapshotError
    return this.state
  }

  override callTool(_request: McpCallToolRequest): Promise<McpResult> {
    return Promise.resolve({ content: [] })
  }

  force(next: McpServerSnapshot | undefined): void {
    this.commit(next)
  }

  deferConnect(): PromiseWithResolvers<McpServerSnapshot> {
    this.connectGate = Promise.withResolvers<McpServerSnapshot>()
    return this.connectGate
  }

  deferDisconnect(): PromiseWithResolvers<void> {
    this.disconnectGate = Promise.withResolvers()
    return this.disconnectGate
  }

  private commit(next: McpServerSnapshot | undefined): void {
    this.state = {
      revision: this.state.revision + 1,
      servers: next === undefined ? [] : [next],
    }
    this.notifyChange()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(value: string | null = SECRET): Promise<{
  ctx: Context
  credentials: MemoryCredentials
  mcp: FakeMcpRuntime
  gateway: TencentDocsConnectorGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials, value ?? undefined)
  await ctx.plugin(FakeMcpRuntime)
  await ctx.plugin(TencentDocsConnectorGateway)
  return {
    ctx,
    credentials: ctx.credentials as MemoryCredentials,
    mcp: ctx.mcp as FakeMcpRuntime,
    gateway: ctx.get('tencentDocsConnector') as TencentDocsConnectorGateway,
  }
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('TencentDocsConnectorGateway', () => {
  it('starts disconnected and describes a configured credential without connecting or resolving it', async () => {
    const { credentials, gateway, mcp } = await harness()

    await expect(gateway.get()).resolves.toMatchObject({
      status: 'disconnected',
      credentialConfigured: true,
      credentialSource: 'memory',
      credentialWritable: true,
      toolCount: 0,
      errorCode: null,
      errorMessage: null,
    })
    expect(credentials.describeCalls).toBeGreaterThanOrEqual(2)
    expect(credentials.resolveCalls).toBe(0)
    expect(mcp.connects).toHaveLength(0)
  })

  it('returns only credential-free fields from publicGet without reading the credential provider', async () => {
    const { credentials, gateway } = await harness()
    const callsBefore = {
      describe: credentials.describeCalls,
      resolve: credentials.resolveCalls,
    }

    const snapshot = await gateway.publicGet()

    expect(snapshot).toEqual({
      status: 'disconnected',
      toolCount: 0,
      errorCode: null,
      errorMessage: null,
      updatedAt: expect.any(String),
    })
    expect(Object.keys(snapshot).sort()).toEqual([
      'errorCode', 'errorMessage', 'status', 'toolCount', 'updatedAt',
    ])
    expect(JSON.stringify(snapshot)).not.toContain(SECRET)
    expect({
      describe: credentials.describeCalls,
      resolve: credentials.resolveCalls,
    }).toEqual(callsBefore)
  })

  it('keeps an absent descriptor source private and ignores unrelated credential notifications', async () => {
    const { credentials, gateway } = await harness()
    credentials.source = undefined
    await expect(gateway.get()).resolves.toMatchObject({
      credentialConfigured: true,
      credentialSource: null,
    })
    await expect(gateway.connect()).resolves.toMatchObject({
      status: 'connected',
      credentialSource: null,
    })
    await gateway.disconnect()
    const before = await gateway.get()

    credentials.announce(credentialRef('ANOTHER_TOKEN'))
    await tick()
    expect(await gateway.get()).toEqual(before)
  })

  it('clears a credential lookup failure after a disconnected credential refresh succeeds', async () => {
    const { credentials, gateway } = await harness()
    credentials.describeError = new Error(`descriptor saw ${SECRET}`)
    await expect(gateway.get()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CREDENTIAL_LOOKUP_FAILED',
    })

    credentials.describeError = undefined
    credentials.announce(TENCENT_DOCS_MCP_CREDENTIAL_REF)
    await tick()
    await expect(gateway.get()).resolves.toMatchObject({
      status: 'disconnected',
      credentialConfigured: true,
      errorCode: null,
    })
  })

  it('uses only the fixed endpoint and raw credential reference, then connects after tools are listed', async () => {
    const { ctx, credentials, gateway, mcp } = await harness()
    const snapshots: TencentDocsConnectorEventSnapshot[] = []
    ctx.on('tencent-docs-connector/change', (snapshot) => { snapshots.push(snapshot) })
    const gate = mcp.deferConnect()

    const pending = gateway.connect()
    await tick()
    expect(snapshots.at(-1)).toMatchObject({ status: 'connecting', toolCount: 0 })
    let settled = false
    void pending.then(() => { settled = true })
    await tick()
    expect(settled).toBe(false)

    gate.resolve(server('connected', { tools: TOOLS }))
    await expect(pending).resolves.toMatchObject({ status: 'connected', toolCount: 2 })
    expect(credentials.resolveCalls).toBe(1)
    expect(mcp.connects).toEqual([{
      serverName: TENCENT_DOCS_MCP_SERVER_NAME,
      transport: {
        kind: 'streamable-http',
        url: TENCENT_DOCS_MCP_ENDPOINT,
        authorization: {
          kind: 'credential',
          ref: TENCENT_DOCS_MCP_CREDENTIAL_REF,
          scheme: 'raw',
        },
      },
    }])
    expect(JSON.stringify({ snapshots, requests: mcp.connects })).not.toContain(SECRET)
  })

  it('fails without calling MCP when the space MCP Token is missing', async () => {
    const { gateway, mcp } = await harness(null)

    await expect(gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      credentialConfigured: false,
      errorCode: 'CREDENTIAL_MISSING',
      errorMessage: 'Save a Tencent Docs space MCP Token before connecting.',
    })
    await expect(gateway.get()).resolves.toMatchObject({ errorCode: 'CREDENTIAL_MISSING' })
    expect(mcp.connects).toHaveLength(0)
  })

  it('maps an HTTP 401 to fixed safe copy without returning provider diagnostics or the Token', async () => {
    const { ctx, gateway, mcp } = await harness()
    const snapshots: TencentDocsConnectorEventSnapshot[] = []
    ctx.on('tencent-docs-connector/change', (snapshot) => { snapshots.push(snapshot) })
    mcp.connectError = { statusCode: 401, message: `rejected ${SECRET}` }
    mcp.connectErrorCode = 'HTTP_401'
    mcp.connectErrorMessage = `Authorization ${SECRET}`

    await expect(gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'AUTH_REJECTED',
      errorMessage: 'Tencent Docs rejected the current Token. Update it and try again.',
    })
    expect(JSON.stringify(snapshots)).not.toContain(SECRET)
  })

  it('disconnects an existing failed or connected entry before every retry', async () => {
    const { gateway, mcp } = await harness()
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected' })
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected' })

    expect(mcp.history).toEqual([
      `connect:${TENCENT_DOCS_MCP_SERVER_NAME}`,
      `disconnect:${TENCENT_DOCS_MCP_SERVER_NAME}`,
      `connect:${TENCENT_DOCS_MCP_SERVER_NAME}`,
    ])
  })

  it('projects credential updates and MCP reconnect generations as complete snapshots', async () => {
    const { ctx, credentials, gateway, mcp } = await harness()
    const snapshots: TencentDocsConnectorEventSnapshot[] = []
    ctx.on('tencent-docs-connector/change', (snapshot) => { snapshots.push(snapshot) })
    await gateway.connect()

    mcp.force(server('reconnecting'))
    expect(snapshots.at(-1)).toMatchObject({ status: 'reconnecting', toolCount: 0 })
    await credentials.unset(TENCENT_DOCS_MCP_CREDENTIAL_REF)
    await tick()
    expect(snapshots.at(-1)).toMatchObject({ status: 'failed', errorCode: 'CREDENTIAL_MISSING' })
    expect(snapshots.at(-1)).not.toHaveProperty('credentialConfigured')
    expect(snapshots.at(-1)).not.toHaveProperty('credentialSource')
    expect(snapshots.at(-1)).not.toHaveProperty('credentialWritable')
    expect(mcp.snapshot().servers).toEqual([])

    credentials.source = 'project-file'
    await credentials.set(TENCENT_DOCS_MCP_CREDENTIAL_REF, 'rotated-token')
    await tick()
    expect(snapshots.at(-1)).toMatchObject({ status: 'failed', toolCount: 0 })
    await expect(gateway.get()).resolves.toMatchObject({
      credentialConfigured: true,
      credentialSource: 'project-file',
    })
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected', toolCount: 2 })
  })

  it('waits for MCP quiescence before disconnect resolves', async () => {
    const { ctx, gateway, mcp } = await harness()
    const statuses: string[] = []
    ctx.on('tencent-docs-connector/change', (snapshot) => { statuses.push(snapshot.status) })
    await gateway.connect()
    const gate = mcp.deferDisconnect()

    let settled = false
    const pending = gateway.disconnect().then((snapshot) => {
      settled = true
      return snapshot
    })
    await tick()
    expect(settled).toBe(false)
    expect(statuses.at(-1)).toBe('disconnecting')
    gate.resolve()
    await expect(pending).resolves.toMatchObject({ status: 'disconnected', toolCount: 0 })
  })

  it('makes disconnect idempotent when no Tencent Docs MCP entry exists', async () => {
    const { gateway, mcp } = await harness()

    await expect(gateway.disconnect()).resolves.toMatchObject({ status: 'disconnected' })
    expect(mcp.disconnects).toHaveLength(0)
  })

  it('ignores an unrequested same-name runtime entry until the user connects', async () => {
    const { gateway, mcp } = await harness()

    mcp.force(server('connected', { tools: TOOLS }))
    await expect(gateway.get()).resolves.toMatchObject({ status: 'disconnected', toolCount: 0 })
  })

  it('disconnects and awaits the active MCP generation during Host teardown', async () => {
    const { ctx, gateway, mcp } = await harness()
    await gateway.connect()
    const gate = mcp.deferDisconnect()

    let disposed = false
    const pending = ctx.fiber.dispose().then(() => { disposed = true })
    contexts.splice(contexts.indexOf(ctx), 1)
    await tick()
    expect(disposed).toBe(false)
    expect(mcp.disconnects).toEqual([TENCENT_DOCS_MCP_SERVER_NAME])
    gate.resolve()
    await pending
    expect(disposed).toBe(true)
  })

  it('contains credential, connection, loss, and disconnection failures in safe snapshot codes', async () => {
    const first = await harness()
    first.credentials.resolveError = new Error(`resolver saw ${SECRET}`)
    await expect(first.gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CREDENTIAL_LOOKUP_FAILED',
      errorMessage: 'Unable to read the Tencent Docs Token configuration.',
    })

    const second = await harness()
    second.mcp.connectError = new Error('network unavailable')
    await expect(second.gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CONNECTION_FAILED',
      errorMessage: 'Unable to connect to Tencent Docs. Try again later.',
    })

    const third = await harness()
    await third.gateway.connect()
    third.mcp.force(undefined)
    await expect(third.gateway.get()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CONNECTION_LOST',
      errorMessage: 'The Tencent Docs connection was lost. Try again.',
    })

    const fourth = await harness()
    await fourth.gateway.connect()
    fourth.mcp.disconnectError = new Error('busy')
    await expect(fourth.gateway.disconnect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'DISCONNECT_FAILED',
      errorMessage: 'Unable to disconnect from Tencent Docs. Try again.',
    })

    const fifth = await harness()
    fifth.credentials.describeError = new Error(`descriptor saw ${SECRET}`)
    await expect(fifth.gateway.get()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CREDENTIAL_LOOKUP_FAILED',
      errorMessage: 'Unable to read the Tencent Docs Token configuration.',
    })
  })

  it('does not start a replacement transport when removing the prior entry fails', async () => {
    const configured = await harness()
    await configured.gateway.connect()
    configured.mcp.disconnectError = new Error('busy')
    await expect(configured.gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'DISCONNECT_FAILED',
    })
    expect(configured.mcp.connects).toHaveLength(1)

    const missing = await harness()
    await missing.gateway.connect()
    missing.mcp.disconnectError = new Error('busy')
    await missing.credentials.unset(TENCENT_DOCS_MCP_CREDENTIAL_REF)
    await tick()
    await expect(missing.gateway.connect()).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'DISCONNECT_FAILED',
    })
    expect(missing.mcp.connects).toHaveLength(1)
  })

  it('maps nested authorization and runtime credential failures to stable codes', async () => {
    const first = await harness()
    first.mcp.connectError = { cause: { code: 'UNAUTHORIZED' } }
    await expect(first.gateway.connect()).resolves.toMatchObject({ errorCode: 'AUTH_REJECTED' })

    const second = await harness()
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    second.mcp.connectError = cycle
    second.mcp.connectErrorCode = 'CREDENTIAL_MISSING'
    await expect(second.gateway.connect()).resolves.toMatchObject({ errorCode: 'CREDENTIAL_MISSING' })

    const third = await harness()
    third.mcp.connectError = 'CREDENTIAL_MISSING'
    await expect(third.gateway.connect()).resolves.toMatchObject({ errorCode: 'CREDENTIAL_MISSING' })

    const fourth = await harness()
    fourth.mcp.connectError = 401
    await expect(fourth.gateway.connect()).resolves.toMatchObject({ errorCode: 'AUTH_REJECTED' })

    const fifth = await harness()
    const authCycle: { cause?: unknown } = {}
    authCycle.cause = authCycle
    fifth.mcp.connectError = authCycle
    await expect(fifth.gateway.connect()).resolves.toMatchObject({ errorCode: 'CONNECTION_FAILED' })

    const sixth = await harness()
    sixth.mcp.connectError = true
    await expect(sixth.gateway.connect()).resolves.toMatchObject({ errorCode: 'CONNECTION_FAILED' })
  })

  it('contains queued failures and continues serving later Remote operations', async () => {
    const { gateway, mcp } = await harness()
    mcp.snapshotError = new Error('snapshot unavailable')
    await expect(gateway.get()).rejects.toThrow('snapshot unavailable')
    mcp.snapshotError = undefined
    await expect(gateway.get()).resolves.toMatchObject({ status: 'disconnected' })
  })

  it('suppresses late connect results and state events once teardown starts', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
      const { ctx, gateway, mcp } = await harness()
      const gate = mcp.deferConnect()
      const pendingConnect = gateway.connect()
      await tick()
      const pendingDispose = ctx.fiber.dispose()
      contexts.splice(contexts.indexOf(ctx), 1)
      if (outcome === 'resolve') gate.resolve(server('connected', { tools: TOOLS }))
      else gate.reject(new Error('late connect failure'))
      await pendingConnect
      await pendingDispose
    }
  })

  it('suppresses late disconnect results once teardown starts', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
      const { ctx, gateway, mcp } = await harness()
      await gateway.connect()
      const gate = mcp.deferDisconnect()
      const pendingDisconnect = gateway.disconnect()
      await tick()
      const pendingDispose = ctx.fiber.dispose()
      contexts.splice(contexts.indexOf(ctx), 1)
      if (outcome === 'resolve') gate.resolve()
      else gate.reject(new Error('late disconnect failure'))
      await pendingDisconnect
      await pendingDispose
    }
  })

  it('does not emit a credential refresh that finishes after teardown starts', async () => {
    const { ctx, credentials, gateway } = await harness()
    credentials.source = 'rotated-source'
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    credentials.describeGate = gate
    const pendingGet = gateway.get()
    await tick()
    const pendingDispose = ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)
    gate.resolve()
    await pendingGet
    await pendingDispose
  })

  it('stops a connect whose credential read finishes after teardown starts', async () => {
    const { ctx, credentials, gateway, mcp } = await harness()
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    credentials.describeGate = gate
    const pendingConnect = gateway.connect()
    await tick()
    const pendingDispose = ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)
    gate.resolve()
    await expect(pendingConnect).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CREDENTIAL_LOOKUP_FAILED',
    })
    await pendingDispose
    expect(mcp.connects).toHaveLength(0)
  })

  it('stops a queued credential event refresh after teardown starts', async () => {
    const { ctx, credentials } = await harness()
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    credentials.describeGate = gate
    credentials.announce(TENCENT_DOCS_MCP_CREDENTIAL_REF)
    await tick()
    const pendingDispose = ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)
    gate.resolve()
    await pendingDispose
  })

  it('returns the retained safe snapshot when called after service disposal', async () => {
    const { ctx, gateway } = await harness()
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)

    await expect(gateway.connect()).resolves.toMatchObject({ status: 'disconnected' })
    await expect(gateway.disconnect()).resolves.toMatchObject({ status: 'disconnected' })
  })
})
