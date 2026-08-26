import { describe, expect, it, vi } from 'vitest'
import type {
  ClientRemote,
  IApiClient,
  McpConnectorId,
  McpConnectorView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { ManagedMcpConnectorsController } from '../src/client/controller.ts'

const ID = 'mail-demo' as McpConnectorId
const PRESENTATION = {
  logo: '邮',
  name: { zh: '邮箱示例', en: 'Mail Demo' },
  description: { zh: '邮件工具', en: 'Mail tools' },
  credentialName: { zh: '访问令牌', en: 'Access Token' },
  credentialHelpUrl: 'https://mail.example.test/token',
  credentialHelpLabel: { zh: '获取令牌', en: 'Get Token' },
} as const

function view(overrides: Partial<McpConnectorView['snapshot']> = {}): McpConnectorView {
  return {
    id: ID,
    presentation: PRESENTATION,
    credentialRef: 'MAIL_DEMO_TOKEN' as never,
    snapshot: {
      status: 'disconnected',
      credentialConfigured: false,
      credentialSource: null,
      credentialWritable: true,
      toolCount: 0,
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-08-26T00:00:00.000Z',
      ...overrides,
    },
  }
}

function remote(overrides: Partial<ClientRemote['mcpConnectors']> = {}): ClientRemote['mcpConnectors'] {
  return {
    list: vi.fn(async () => ({ ok: true as const, value: { connectors: [view()] } })),
    publicList: vi.fn(async () => ({ ok: true as const, value: { connectors: [{
      id: ID,
      presentation: PRESENTATION,
      snapshot: {
        status: 'disconnected' as const,
        toolCount: 0,
        errorCode: null,
        errorMessage: null,
        updatedAt: '2026-08-26T00:00:00.000Z',
      },
    }] } })),
    connect: vi.fn(async () => ({ ok: true as const, value: view({
      status: 'connected', credentialConfigured: true, toolCount: 3,
    }) })),
    disconnect: vi.fn(async () => ({ ok: true as const, value: view({
      credentialConfigured: true,
    }) })),
    ...overrides,
  }
}

function credentials(overrides: Partial<Pick<IApiClient, 'credentials'>['credentials']> = {}) {
  return {
    credentials: {
      describe: vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: { credentials: {} } } })),
      set: vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: {} } })),
      unset: vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: {} } })),
      ...overrides,
    },
  } as Pick<IApiClient, 'credentials'>
}

describe('ManagedMcpConnectorsController', () => {
  it('loads a catalog, stores a write-only draft, connects, disconnects, and clears drafts', async () => {
    const connector = remote()
    const setCredential = vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: {} } }))
    const unsetCredential = vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: {} } }))
    const credentialApi = credentials({ set: setCredential, unset: unsetCredential })
    const controller = new ManagedMcpConnectorsController(connector, credentialApi)

    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().connectors).toHaveLength(1) })
    controller.setDraft(ID, ' mail-token ')
    await controller.connect(ID)
    expect(setCredential).toHaveBeenCalledWith({ ref: 'MAIL_DEMO_TOKEN', value: 'mail-token' })
    expect(connector.connect).toHaveBeenCalledWith(ID)
    expect(controller.store.getSnapshot().connectors[0]).toMatchObject({
      draft: '', pending: null, connector: { status: 'connected', toolCount: 3 },
    })

    await controller.disconnect(ID)
    expect(unsetCredential).toHaveBeenCalledWith({ ref: 'MAIL_DEMO_TOKEN' })
    controller.setDraft(ID, 'temporary')
    controller.close()
    expect(controller.store.getSnapshot()).toMatchObject({ open: false, connectors: [{ draft: '' }] })
    controller.dispose()
    controller.open()
    controller.setDraft(ID, 'ignored')
    await controller.connect(ID)
    await controller.disconnect(ID)
    expect(controller.store.getSnapshot().open).toBe(false)
  })

  it('keeps public clients value-free and accepts pushed catalog replacement', async () => {
    const connector = remote()
    const controller = new ManagedMcpConnectorsController(connector, undefined)
    controller.open()
    await vi.waitFor(() => { expect(connector.publicList).toHaveBeenCalledOnce() })

    controller.setDraft(ID, 'ignored')
    controller.credentialsUpdated('MAIL_DEMO_TOKEN')
    await controller.connect(ID)
    await controller.disconnect(ID)
    controller.accept({ connectors: [{
      id: ID,
      presentation: PRESENTATION,
      snapshot: {
        status: 'connected', toolCount: 4, errorCode: null, errorMessage: null,
        updatedAt: '2026-08-26T00:00:01.000Z',
      },
    }] })
    expect(controller.store.getSnapshot().connectors[0]).toMatchObject({
      credentialRef: null,
      connector: { status: 'connected', toolCount: 4, credentialConfigured: false },
    })
    controller.dispose()
    controller.accept({ connectors: [] })
  })

  it('reports list and mutation carrier failures without exposing a credential', async () => {
    const failedList = remote({
      list: vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE', message: 'list failed', details: {} } })),
    })
    const controller = new ManagedMcpConnectorsController(failedList, credentials())
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().error).toBe('list failed') })

    const failedConnect = remote({
      connect: vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE', message: 'connect failed', details: {} } })),
      disconnect: vi.fn(async () => { throw new Error('disconnect failed') }),
    })
    const second = new ManagedMcpConnectorsController(failedConnect, credentials())
    second.open()
    await vi.waitFor(() => { expect(second.store.getSnapshot().connectors).toHaveLength(1) })
    second.setDraft(ID, 'token')
    await second.connect(ID)
    expect(second.store.getSnapshot().connectors[0]).toMatchObject({ error: 'connect failed', pending: null })
    await second.disconnect(ID)
    expect(second.store.getSnapshot().connectors[0]).toMatchObject({ error: 'disconnect failed', pending: null })
  })

  it('refreshes only for the matching credential while open', async () => {
    const connector = remote()
    const controller = new ManagedMcpConnectorsController(connector, credentials())
    controller.credentialsUpdated('MAIL_DEMO_TOKEN')
    controller.open()
    await vi.waitFor(() => { expect(connector.list).toHaveBeenCalledOnce() })
    controller.credentialsUpdated('OTHER_TOKEN')
    expect(connector.list).toHaveBeenCalledOnce()
    controller.credentialsUpdated('MAIL_DEMO_TOKEN')
    await vi.waitFor(() => { expect(connector.list).toHaveBeenCalledTimes(2) })
  })

  it('refuses missing input and supports a configured credential without a new draft', async () => {
    const connector = remote()
    const controller = new ManagedMcpConnectorsController(connector, credentials())
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().connectors).toHaveLength(1) })
    await controller.connect(ID)
    expect(connector.connect).not.toHaveBeenCalled()

    controller.accept({ connectors: [{
      id: ID,
      presentation: PRESENTATION,
      snapshot: {
        status: 'disconnected', toolCount: 0, errorCode: null, errorMessage: null,
        updatedAt: '2026-08-26T00:00:01.000Z',
      },
    }] })
    await controller.connect(ID)
    expect(connector.connect).not.toHaveBeenCalled()

    const configuredRemote = remote({
      list: vi.fn(async () => ({ ok: true as const, value: { connectors: [view({
        credentialConfigured: true,
      })] } })),
    })
    const configured = new ManagedMcpConnectorsController(configuredRemote, credentials())
    configured.open()
    await vi.waitFor(() => { expect(configured.store.getSnapshot().connectors).toHaveLength(1) })
    await configured.connect(ID)
    expect(configuredRemote.connect).toHaveBeenCalledOnce()
  })

  it('ignores late connect and disconnect settlements after disposal', async () => {
    const setGate = Promise.withResolvers<Awaited<ReturnType<Pick<IApiClient, 'credentials'>['credentials']['set']>>>()
    const credentialApi = credentials({ set: vi.fn(() => setGate.promise) })
    const connector = remote()
    const controller = new ManagedMcpConnectorsController(connector, credentialApi)
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().connectors).toHaveLength(1) })
    controller.setDraft(ID, 'token')
    const pending = controller.connect(ID)
    controller.dispose()
    setGate.resolve({ rpcId: 'test' as never, result: { ok: true, value: {} } })
    await pending
    expect(connector.connect).not.toHaveBeenCalled()

    const connectGate = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['connect']>>>()
    const lateRemote = remote({ connect: vi.fn(() => connectGate.promise) })
    const late = new ManagedMcpConnectorsController(lateRemote, credentials())
    late.open()
    await vi.waitFor(() => { expect(late.store.getSnapshot().connectors).toHaveLength(1) })
    late.setDraft(ID, 'token')
    const latePending = late.connect(ID)
    await vi.waitFor(() => { expect(lateRemote.connect).toHaveBeenCalledOnce() })
    late.dispose()
    connectGate.resolve({ ok: true, value: view({ status: 'connected' }) })
    await latePending

    const disconnectGate = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['disconnect']>>>()
    const disconnectRemote = remote({ disconnect: vi.fn(() => disconnectGate.promise) })
    const disconnecting = new ManagedMcpConnectorsController(disconnectRemote, credentials())
    disconnecting.open()
    await vi.waitFor(() => { expect(disconnecting.store.getSnapshot().connectors).toHaveLength(1) })
    const disconnectPending = disconnecting.disconnect(ID)
    disconnecting.dispose()
    disconnectGate.resolve({ ok: true, value: view() })
    await disconnectPending
  })

  it('handles public refresh failures, stale refreshes, and non-writable disconnects', async () => {
    const publicFailure = new ManagedMcpConnectorsController(remote({
      publicList: vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE', message: 'public failed', details: {} } })),
    }), undefined)
    publicFailure.open()
    await vi.waitFor(() => { expect(publicFailure.store.getSnapshot().error).toBe('public failed') })

    const listGate = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['list']>>>()
    const staleRemote = remote({ list: vi.fn(() => listGate.promise) })
    const stale = new ManagedMcpConnectorsController(staleRemote, credentials())
    stale.open()
    stale.accept({ connectors: [] })
    listGate.resolve({ ok: true, value: { connectors: [view()] } })
    await Promise.resolve()
    expect(stale.store.getSnapshot().connectors).toHaveLength(0)

    const nonWritableRemote = remote({
      list: vi.fn(async () => ({ ok: true as const, value: { connectors: [view({
        credentialConfigured: true,
        credentialWritable: false,
      })] } })),
      disconnect: vi.fn(async () => ({ ok: true as const, value: view({
        credentialConfigured: true,
        credentialWritable: false,
      }) })),
    })
    const unsetCredential = vi.fn(async () => ({ rpcId: 'test' as never, result: { ok: true as const, value: {} } }))
    const credentialApi = credentials({ unset: unsetCredential })
    const nonWritable = new ManagedMcpConnectorsController(nonWritableRemote, credentialApi)
    nonWritable.open()
    await vi.waitFor(() => { expect(nonWritable.store.getSnapshot().connectors).toHaveLength(1) })
    await nonWritable.disconnect(ID)
    expect(unsetCredential).not.toHaveBeenCalled()
  })

  it('keeps provider cards independent and preserves public card state across refreshes', async () => {
    const secondId = 'calendar-demo' as McpConnectorId
    const secondView = { ...view(), id: secondId }
    const connector = remote({
      list: vi.fn(async () => ({ ok: true as const, value: { connectors: [view(), secondView] } })),
      publicList: vi.fn(async () => ({ ok: true as const, value: { connectors: [{
        id: ID,
        presentation: PRESENTATION,
        snapshot: {
          status: 'disconnected' as const,
          toolCount: 0,
          errorCode: null,
          errorMessage: null,
          updatedAt: '2026-08-26T00:00:00.000Z',
        },
      }] } })),
    })
    const privateController = new ManagedMcpConnectorsController(connector, credentials())
    privateController.open()
    await vi.waitFor(() => { expect(privateController.store.getSnapshot().connectors).toHaveLength(2) })
    privateController.setDraft(ID, 'first-only')
    expect(privateController.store.getSnapshot().connectors.map(card => card.draft)).toEqual(['first-only', ''])

    const publicController = new ManagedMcpConnectorsController(connector, undefined)
    publicController.open()
    await vi.waitFor(() => { expect(publicController.store.getSnapshot().connectors).toHaveLength(1) })
    publicController.close()
    publicController.open()
    await vi.waitFor(() => { expect(connector.publicList).toHaveBeenCalledTimes(2) })
    expect(publicController.store.getSnapshot().connectors).toHaveLength(1)
  })

  it('contains late mutation and refresh failures after invalidation', async () => {
    const failedConnect = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['connect']>>>()
    const connectRemote = remote({ connect: vi.fn(() => failedConnect.promise) })
    const connecting = new ManagedMcpConnectorsController(connectRemote, credentials())
    connecting.open()
    await vi.waitFor(() => { expect(connecting.store.getSnapshot().connectors).toHaveLength(1) })
    connecting.setDraft(ID, 'token')
    const connectPending = connecting.connect(ID)
    await vi.waitFor(() => { expect(connectRemote.connect).toHaveBeenCalledOnce() })
    connecting.dispose()
    failedConnect.reject(new Error('late connect failure'))
    await connectPending

    const rejectedDisconnect = new ManagedMcpConnectorsController(remote({
      disconnect: vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE', message: 'rejected', details: {} } })),
    }), credentials())
    rejectedDisconnect.open()
    await vi.waitFor(() => { expect(rejectedDisconnect.store.getSnapshot().connectors).toHaveLength(1) })
    await rejectedDisconnect.disconnect(ID)
    expect(rejectedDisconnect.store.getSnapshot().connectors[0]?.error).toBe('rejected')

    const unsetGate = Promise.withResolvers<Awaited<ReturnType<Pick<IApiClient, 'credentials'>['credentials']['unset']>>>()
    const unsetRemote = remote()
    const unsetting = new ManagedMcpConnectorsController(unsetRemote, credentials({
      unset: vi.fn(() => unsetGate.promise),
    }))
    unsetting.open()
    await vi.waitFor(() => { expect(unsetting.store.getSnapshot().connectors).toHaveLength(1) })
    const unsetPending = unsetting.disconnect(ID)
    await vi.waitFor(() => { expect(unsetRemote.disconnect).toHaveBeenCalledOnce() })
    unsetting.dispose()
    unsetGate.resolve({ rpcId: 'test' as never, result: { ok: true, value: {} } })
    await unsetPending

    const failedDisconnect = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['disconnect']>>>()
    const disconnectRemote = remote({ disconnect: vi.fn(() => failedDisconnect.promise) })
    const disconnecting = new ManagedMcpConnectorsController(disconnectRemote, credentials())
    disconnecting.open()
    await vi.waitFor(() => { expect(disconnecting.store.getSnapshot().connectors).toHaveLength(1) })
    const disconnectPending = disconnecting.disconnect(ID)
    disconnecting.dispose()
    failedDisconnect.reject(new Error('late disconnect failure'))
    await disconnectPending

    const publicGate = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['publicList']>>>()
    const stalePublic = new ManagedMcpConnectorsController(remote({ publicList: vi.fn(() => publicGate.promise) }), undefined)
    stalePublic.open()
    stalePublic.accept({ connectors: [] })
    publicGate.resolve({ ok: true, value: { connectors: [] } })
    await Promise.resolve()

    const listGate = Promise.withResolvers<Awaited<ReturnType<ClientRemote['mcpConnectors']['list']>>>()
    const staleFailure = new ManagedMcpConnectorsController(remote({ list: vi.fn(() => listGate.promise) }), credentials())
    staleFailure.open()
    staleFailure.accept({ connectors: [] })
    listGate.reject(new Error('late list failure'))
    await Promise.resolve()
    expect(staleFailure.store.getSnapshot().error).toBeNull()
  })
})
