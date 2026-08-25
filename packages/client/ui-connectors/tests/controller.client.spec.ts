import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientRemote,
  IApiClient,
  TencentDocsConnectorEventSnapshot,
  TencentDocsConnectorSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  CONNECTOR_REQUEST_FAILED,
  ConnectorsPanelController,
  TENCENT_DOCS_CREDENTIAL_REF,
} from '../src/client/controller.ts'

const DISCONNECTED: TencentDocsConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: true,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: '2026-08-25T00:00:00.000Z',
}

type ConnectorResult = Awaited<ReturnType<ClientRemote['tencentDocsConnector']['get']>>
type PublicConnectorResult = Awaited<ReturnType<ClientRemote['tencentDocsConnector']['publicGet']>>

function succeeded(value: TencentDocsConnectorSnapshot): ConnectorResult {
  return { ok: true, value }
}

function failed(message: string): ConnectorResult {
  return { ok: false, error: { code: 'TEST_FAILURE', message, details: {} } }
}

function publicSucceeded(value: TencentDocsConnectorEventSnapshot): PublicConnectorResult {
  return { ok: true, value }
}

function publicFailed(message: string): PublicConnectorResult {
  return { ok: false, error: { code: 'TEST_FAILURE', message, details: {} } }
}

function publicSnapshot(snapshot: TencentDocsConnectorSnapshot): TencentDocsConnectorEventSnapshot {
  return {
    status: snapshot.status,
    toolCount: snapshot.toolCount,
    errorCode: snapshot.errorCode,
    errorMessage: snapshot.errorMessage,
    updatedAt: snapshot.updatedAt,
  }
}

function setCredential(
  controller: ConnectorsPanelController,
  credential: Partial<Pick<
    TencentDocsConnectorSnapshot,
    'credentialConfigured' | 'credentialSource' | 'credentialWritable'
  >> = {},
): void {
  controller.store.update((state) => {
    state.connector = {
      ...state.connector,
      credentialConfigured: credential.credentialConfigured ?? true,
      credentialSource: credential.credentialSource ?? 'file',
      credentialWritable: credential.credentialWritable ?? true,
    }
  })
}

afterEach(() => { vi.restoreAllMocks() })

function remote(
  overrides: Partial<ClientRemote['tencentDocsConnector']> = {},
): ClientRemote['tencentDocsConnector'] {
  return {
    get: vi.fn(async () => succeeded(DISCONNECTED)),
    publicGet: vi.fn(async () => publicSucceeded(publicSnapshot(DISCONNECTED))),
    connect: vi.fn(async () => succeeded({
      ...DISCONNECTED, status: 'connected', credentialConfigured: true, toolCount: 3,
    })),
    disconnect: vi.fn(async () => succeeded(DISCONNECTED)),
    ...overrides,
  }
}

function credentials(overrides: Partial<IApiClient['credentials']> = {}): Pick<IApiClient, 'credentials'> {
  return {
    credentials: {
      describe: vi.fn(async () => ({
        result: { ok: true, value: { credentials: {
          [TENCENT_DOCS_CREDENTIAL_REF]: { configured: false, writable: true },
        } } },
      }) as never),
      set: vi.fn(async () => ({ result: { ok: true, value: {} } }) as never),
      unset: vi.fn(async () => ({ result: { ok: true, value: {} } }) as never),
      ...overrides,
    },
  }
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  let reject: ((error: unknown) => void) | undefined
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return {
    promise,
    resolve: (value: T) => { resolve?.(value) },
    reject: (error: unknown) => { reject?.(error) },
  }
}

describe('ConnectorsPanelController', () => {
  it('opens with value-free connector and credential reconciliation, then clears its draft on close', async () => {
    const api = remote()
    const describe = vi.fn(async () => ({ result: { ok: true, value: { credentials: {
      [TENCENT_DOCS_CREDENTIAL_REF]: { configured: true, source: 'env', writable: false },
    } } } }) as never)
    const secret = credentials({ describe })
    const controller = new ConnectorsPanelController(api, secret)
    controller.open()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().connector.credentialSource).toBe('env')
    })
    expect(describe).toHaveBeenCalledWith({ refs: [TENCENT_DOCS_CREDENTIAL_REF] })
    expect(controller.store.getSnapshot()).toMatchObject({
      open: true,
      loopback: true,
      connector: { credentialConfigured: true, credentialSource: 'env', credentialWritable: false },
    })
    controller.setDraft('temporary-token')
    controller.close()
    expect(controller.store.getSnapshot()).toMatchObject({ open: false, draft: '' })
  })

  it('does not let an old open refresh replace newer connected and reconnecting pushes', async () => {
    const staleGet = deferred<{ ok: true; value: TencentDocsConnectorSnapshot }>()
    const staleDescribe = deferred<Awaited<ReturnType<IApiClient['credentials']['describe']>>>()
    const api = remote({ get: vi.fn(() => staleGet.promise) })
    const secret = credentials({ describe: vi.fn(() => staleDescribe.promise) })
    const controller = new ConnectorsPanelController(api, secret)

    controller.open()
    controller.accept({
      status: 'connected',
      toolCount: 4,
      errorCode: null,
      errorMessage: null,
      updatedAt: DISCONNECTED.updatedAt,
    })
    controller.accept({
      status: 'reconnecting',
      toolCount: 4,
      errorCode: null,
      errorMessage: null,
      updatedAt: DISCONNECTED.updatedAt,
    })
    staleGet.resolve({ ok: true, value: DISCONNECTED })
    staleDescribe.resolve({ result: { ok: true, value: { credentials: {
      [TENCENT_DOCS_CREDENTIAL_REF]: { configured: true, source: 'env', writable: false },
    } } } } as never)

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().connector.credentialSource).toBe('env')
    })
    expect(controller.store.getSnapshot().connector).toMatchObject({
      status: 'reconnecting',
      toolCount: 4,
      credentialConfigured: true,
      credentialWritable: false,
    })
  })

  it('sends a new Token only to credentials.set before connecting and forgets the draft', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ]
    const order: string[] = []
    const api = remote({
      connect: vi.fn(async () => {
        order.push('connect')
        return succeeded({ ...DISCONNECTED, status: 'connected', credentialConfigured: true, toolCount: 4 })
      }),
    })
    const set = vi.fn(async ({ value }) => {
      order.push(`set:${value}`)
      return { result: { ok: true, value: {} } } as never
    })
    const secret = credentials({ set })
    const controller = new ConnectorsPanelController(api, secret)
    controller.setDraft(' space-mcp-secret ')
    await controller.connect()
    expect(order).toEqual(['set:space-mcp-secret', 'connect'])
    expect(set).toHaveBeenCalledWith({
      ref: TENCENT_DOCS_CREDENTIAL_REF,
      value: 'space-mcp-secret',
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      draft: '',
      pending: null,
      error: null,
      connector: { status: 'connected', toolCount: 4 },
    })
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('space-mcp-secret')
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })

  it('keeps a connect result when its same-millisecond connecting push arrives late', async () => {
    const api = remote()
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)

    await controller.connect()
    controller.accept({
      status: 'connecting',
      toolCount: 0,
      errorCode: null,
      errorMessage: null,
      updatedAt: DISCONNECTED.updatedAt,
    })

    expect(controller.store.getSnapshot()).toMatchObject({
      pending: null,
      connector: { status: 'connected', toolCount: 3 },
    })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnected' }))
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))
    expect(controller.store.getSnapshot().connector.status).toBe('connecting')
  })

  it('renders a failed snapshot returned by a completed connect mutation', async () => {
    const controller = new ConnectorsPanelController(remote({
      connect: vi.fn(async () => succeeded({
        ...DISCONNECTED, status: 'failed', errorMessage: 'Token refused',
      })),
    }), credentials())
    setCredential(controller)

    await controller.connect()

    expect(controller.store.getSnapshot()).toMatchObject({
      pending: null,
      error: null,
      connector: { status: 'failed', errorMessage: 'Token refused' },
    })
  })

  it('turns a connect carrier failure after a transition push into a retryable terminal state', async () => {
    const first = deferred<ConnectorResult>()
    const api = remote({
      connect: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(succeeded({ ...DISCONNECTED, status: 'connected', credentialConfigured: true })),
    })
    const set = vi.fn(async () => ({ result: { ok: true, value: {} } }) as never)
    const secret = credentials({ set })
    const controller = new ConnectorsPanelController(api, secret)
    setCredential(controller)
    const connecting = controller.connect()
    await vi.waitFor(() => { expect(api.connect).toHaveBeenCalledOnce() })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))
    first.reject(new Error('MCP unavailable'))
    await connecting
    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      pending: null,
      connector: {
        status: 'failed',
        credentialConfigured: true,
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
      },
    })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))
    expect(controller.store.getSnapshot().connector.status).toBe('failed')
    await controller.connect()
    expect(set).not.toHaveBeenCalled()
    expect(api.connect).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot().error).toBeNull()
  })

  it('turns a disconnect carrier failure after a transition push into a retryable terminal state', async () => {
    const result = deferred<ConnectorResult>()
    const api = remote({ disconnect: vi.fn(() => result.promise) })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connected', toolCount: 2 }))

    const disconnecting = controller.disconnect()
    await vi.waitFor(() => { expect(api.disconnect).toHaveBeenCalledOnce() })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnecting' }))
    result.reject(new Error('carrier closed'))
    await disconnecting

    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      pending: null,
      connector: {
        status: 'failed',
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
      },
    })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnecting' }))
    expect(controller.store.getSnapshot().connector.status).toBe('failed')
  })

  it('keeps the last terminal state when a connector request fails before any transition push', async () => {
    const api = remote({ connect: vi.fn(async () => failed('request never reached Host')) })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)

    await controller.connect()

    expect(controller.store.getSnapshot()).toMatchObject({
      error: 'request never reached Host',
      pending: null,
      connector: { status: 'disconnected', errorCode: null, errorMessage: null },
    })
  })

  it('converges a connecting push that arrives after the connect carrier fails', async () => {
    const api = remote({ connect: vi.fn(async () => failed('connect carrier closed')) })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)

    await controller.connect()
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))

    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: {
        status: 'failed',
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
      },
    })
  })

  it('converges a disconnecting push that arrives after the disconnect carrier fails', async () => {
    const api = remote({ disconnect: vi.fn(async () => failed('disconnect carrier closed')) })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connected', toolCount: 2 }))

    await controller.disconnect()
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnecting' }))

    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: {
        status: 'failed',
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
      },
    })
  })

  it('converges a matching open refresh after the connect carrier fails', async () => {
    const api = remote({
      get: vi.fn(async () => succeeded({ ...DISCONNECTED, status: 'connecting' })),
      connect: vi.fn(async () => failed('connect carrier closed')),
    })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)

    await controller.connect()
    controller.open()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().connector.errorCode).toBe(CONNECTOR_REQUEST_FAILED)
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: { status: 'failed', errorMessage: null },
    })
  })

  it('clears a failed-carrier association when a Host terminal state arrives first', async () => {
    const api = remote({ connect: vi.fn(async () => failed('request did not settle')) })
    const controller = new ConnectorsPanelController(api, credentials())
    setCredential(controller)

    await controller.connect()
    controller.accept(publicSnapshot(DISCONNECTED))
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))

    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: { status: 'connecting', errorCode: null, errorMessage: null },
    })
  })

  it('does nothing when connect has no Token, another mutation is pending, or the controller is disposed', async () => {
    const api = remote()
    const secret = credentials()
    const controller = new ConnectorsPanelController(api, secret)
    await controller.connect()
    expect(api.connect).not.toHaveBeenCalled()
    controller.store.update((state) => { state.pending = 'disconnect' })
    controller.setDraft('secret')
    await controller.connect()
    expect(api.connect).not.toHaveBeenCalled()
    controller.store.update((state) => { state.pending = null })
    controller.dispose()
    await controller.connect()
    controller.open()
    expect(api.connect).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({ open: false, draft: '' })
  })

  it('drops successful mutation stages that settle after disposal', async () => {
    const setResult = deferred<Awaited<ReturnType<IApiClient['credentials']['set']>>>()
    const setRemote = remote()
    const setting = new ConnectorsPanelController(setRemote, credentials({
      set: vi.fn(() => setResult.promise),
    }))
    setting.setDraft('secret')
    const setWork = setting.connect()
    setting.dispose()
    setResult.resolve({ result: { ok: true, value: {} } } as never)
    await setWork
    expect(setRemote.connect).not.toHaveBeenCalled()

    const connectResult = deferred<Awaited<ReturnType<ClientRemote['tencentDocsConnector']['connect']>>>()
    const connectingRemote = remote({ connect: vi.fn(() => connectResult.promise) })
    const connecting = new ConnectorsPanelController(connectingRemote, credentials())
    setCredential(connecting)
    const connectWork = connecting.connect()
    await vi.waitFor(() => { expect(connectingRemote.connect).toHaveBeenCalledOnce() })
    connecting.dispose()
    connectResult.resolve(succeeded({ ...DISCONNECTED, status: 'connected' }))
    await connectWork
    expect(connecting.store.getSnapshot().connector.status).toBe('disconnected')

    const disconnectResult = deferred<Awaited<ReturnType<ClientRemote['tencentDocsConnector']['disconnect']>>>()
    const disconnectingRemote = remote({ disconnect: vi.fn(() => disconnectResult.promise) })
    const disconnecting = new ConnectorsPanelController(disconnectingRemote, credentials())
    const disconnectWork = disconnecting.disconnect()
    await vi.waitFor(() => { expect(disconnectingRemote.disconnect).toHaveBeenCalledOnce() })
    disconnecting.dispose()
    disconnectResult.resolve(succeeded(DISCONNECTED))
    await disconnectWork
    expect(disconnecting.store.getSnapshot().connector.status).toBe('disconnected')

    const unsetResult = deferred<Awaited<ReturnType<IApiClient['credentials']['unset']>>>()
    const unset = vi.fn(() => unsetResult.promise)
    const describeAfterUnset = vi.fn(async () => ({ result: { ok: true, value: { credentials: {} } } }) as never)
    const unsettingSecret = credentials({ unset, describe: describeAfterUnset })
    const unsetting = new ConnectorsPanelController(remote(), unsettingSecret)
    const unsetWork = unsetting.disconnect()
    await vi.waitFor(() => { expect(unset).toHaveBeenCalledOnce() })
    unsetting.dispose()
    unsetResult.resolve({ result: { ok: true, value: {} } } as never)
    await unsetWork
    expect(describeAfterUnset).not.toHaveBeenCalled()
  })

  it('disconnects before deleting a writable Token', async () => {
    const order: string[] = []
    const api = remote({
      disconnect: vi.fn(async () => {
        order.push('disconnect')
        return succeeded({ ...DISCONNECTED, credentialConfigured: true, credentialSource: 'file' })
      }),
    })
    const unset = vi.fn(async () => {
      order.push('unset')
      return { result: { ok: true, value: {} } } as never
    })
    const secret = credentials({
      describe: vi.fn(async () => ({ result: { ok: true, value: { credentials: {} } } }) as never),
      unset,
    })
    const controller = new ConnectorsPanelController(api, secret)
    setCredential(controller)
    controller.accept(publicSnapshot({
      ...DISCONNECTED, status: 'connected', toolCount: 2,
    }))
    await controller.disconnect()
    expect(order).toEqual(['disconnect', 'unset'])
    expect(unset).toHaveBeenCalledWith({ ref: TENCENT_DOCS_CREDENTIAL_REF })
    expect(controller.store.getSnapshot()).toMatchObject({
      pending: null,
      connector: { status: 'disconnected', credentialConfigured: false, credentialSource: null },
    })
    controller.accept({
      status: 'disconnecting',
      toolCount: 0,
      errorCode: null,
      errorMessage: null,
      updatedAt: DISCONNECTED.updatedAt,
    })
    expect(controller.store.getSnapshot().connector.status).toBe('disconnected')
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connected' }))
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnecting' }))
    expect(controller.store.getSnapshot().connector.status).toBe('disconnecting')
  })

  it('orders matching credential invalidations and ignores them while closed or for another reference', async () => {
    const oldRead = deferred<Awaited<ReturnType<IApiClient['credentials']['describe']>>>()
    const latestRead = deferred<Awaited<ReturnType<IApiClient['credentials']['describe']>>>()
    const describe = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true, value: { credentials: {
        [TENCENT_DOCS_CREDENTIAL_REF]: { configured: false, writable: true },
      } } } })
      .mockImplementationOnce(() => oldRead.promise)
      .mockImplementationOnce(() => latestRead.promise)
      .mockResolvedValueOnce({ result: { ok: true, value: { credentials: {} } } })
    const controller = new ConnectorsPanelController(remote(), credentials({ describe }))

    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    controller.open()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledOnce() })
    controller.credentialsUpdated('SOME_OTHER_KEY')
    expect(describe).toHaveBeenCalledOnce()

    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    latestRead.resolve({ result: { ok: true, value: { credentials: {
      [TENCENT_DOCS_CREDENTIAL_REF]: { configured: true, source: 'env', writable: false },
    } } } } as never)
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().connector.credentialSource).toBe('env')
    })
    oldRead.resolve({ result: { ok: true, value: { credentials: {
      [TENCENT_DOCS_CREDENTIAL_REF]: { configured: true, source: 'file', writable: true },
    } } } } as never)
    await Promise.resolve()
    expect(controller.store.getSnapshot().connector).toMatchObject({
      credentialConfigured: true,
      credentialSource: 'env',
      credentialWritable: false,
    })

    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(4) })
    expect(controller.store.getSnapshot().connector).toMatchObject({
      credentialConfigured: false,
      credentialSource: null,
      credentialWritable: false,
    })
    controller.close()
    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    expect(describe).toHaveBeenCalledTimes(4)
  })

  it('shows an environment fallback that becomes active after deleting the file Token', async () => {
    const api = remote({
      disconnect: vi.fn(async () => succeeded({
        ...DISCONNECTED, credentialConfigured: true, credentialSource: 'file',
      })),
    })
    const secret = credentials({
      describe: vi.fn(async () => ({ result: { ok: true, value: { credentials: {
        [TENCENT_DOCS_CREDENTIAL_REF]: { configured: true, source: 'env', writable: false },
      } } } }) as never),
    })
    const controller = new ConnectorsPanelController(api, secret)
    setCredential(controller)
    controller.accept(publicSnapshot({
      ...DISCONNECTED, status: 'connected', toolCount: 2,
    }))

    await controller.disconnect()

    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: {
        status: 'disconnected',
        credentialConfigured: true,
        credentialSource: 'env',
        credentialWritable: false,
      },
    })
  })

  it('keeps a read-only Token and does not delete one after a disconnect failure', async () => {
    const unset = vi.fn(async () => ({ result: { ok: true, value: {} } }) as never)
    const secret = credentials({ unset })
    const readOnly = remote({
      disconnect: vi.fn(async () => succeeded({
        ...DISCONNECTED, credentialConfigured: true, credentialSource: 'env', credentialWritable: false,
      })),
    })
    const first = new ConnectorsPanelController(readOnly, secret)
    setCredential(first, { credentialSource: 'env', credentialWritable: false })
    first.accept(publicSnapshot({
      ...DISCONNECTED, status: 'connected',
    }))
    await first.disconnect()
    expect(unset).not.toHaveBeenCalled()
    expect(first.store.getSnapshot().connector.credentialConfigured).toBe(true)

    const refused = remote({ disconnect: vi.fn(async () => failed('still stopping')) })
    const second = new ConnectorsPanelController(refused, secret)
    setCredential(second)
    second.accept(publicSnapshot({ ...DISCONNECTED, status: 'connected' }))
    await second.disconnect()
    expect(unset).not.toHaveBeenCalled()
    expect(second.store.getSnapshot()).toMatchObject({
      error: 'still stopping',
      connector: { status: 'connected', errorCode: null, errorMessage: null },
    })
  })

  it('surfaces credential RPC failures without calling the connector out of order', async () => {
    const api = remote()
    const rejected = credentials({
      set: vi.fn(async () => ({ result: { ok: false, error: { message: 'credential rejected' } } }) as never),
    })
    const controller = new ConnectorsPanelController(api, rejected)
    controller.setDraft('secret')
    await controller.connect()
    expect(api.connect).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({ draft: '', error: 'credential rejected' })

    const deleteRejected = credentials({
      unset: vi.fn(async () => ({ result: { ok: false, error: { message: 'cannot delete' } } }) as never),
    })
    const connected = new ConnectorsPanelController(api, deleteRejected)
    setCredential(connected)
    connected.accept(publicSnapshot({ ...DISCONNECTED, status: 'connected' }))
    await connected.disconnect()
    expect(connected.store.getSnapshot().error).toBe('cannot delete')
  })

  it('loads current public state outside loopback without calling privileged or credential methods', async () => {
    const api = remote({
      publicGet: vi.fn(async () => publicSucceeded(publicSnapshot({
        ...DISCONNECTED, status: 'connected', toolCount: 5,
      }))),
    })
    const controller = new ConnectorsPanelController(api, undefined)
    controller.setDraft('must-not-stick')
    controller.open()
    await controller.connect()
    await controller.disconnect()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.publicGet).toHaveBeenCalledOnce()
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.disconnect).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({
      loopback: false,
      draft: '',
      connector: { status: 'connected', toolCount: 5 },
    })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'reconnecting' }))
    expect(controller.store.getSnapshot().connector.status).toBe('reconnecting')
  })

  it('orders public refreshes against pushes and reports only a current public read failure', async () => {
    const stale = deferred<PublicConnectorResult>()
    const api = remote({
      publicGet: vi.fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementationOnce(async () => publicFailed('public offline')),
    })
    const controller = new ConnectorsPanelController(api, undefined)
    controller.open()
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'reconnecting', toolCount: 4 }))
    stale.resolve(publicSucceeded(publicSnapshot({ ...DISCONNECTED, status: 'connected', toolCount: 3 })))
    await Promise.resolve()
    expect(controller.store.getSnapshot()).toMatchObject({
      error: null,
      connector: { status: 'reconnecting', toolCount: 4 },
    })

    controller.close()
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().error).toBe('public offline') })
  })

  it('publishes refresh errors and ignores Host snapshots after disposal', async () => {
    let resolveGet: ((value: ConnectorResult) => void) | undefined
    const delayed = remote({
      get: vi.fn(() => new Promise<ConnectorResult>((resolve) => { resolveGet = resolve })),
    })
    const controller = new ConnectorsPanelController(delayed, credentials())
    controller.open()
    controller.dispose()
    resolveGet?.(succeeded({ ...DISCONNECTED, status: 'connected' }))
    await Promise.resolve()
    expect(controller.store.getSnapshot().connector.status).toBe('disconnected')

    const failedController = new ConnectorsPanelController(remote({
      get: vi.fn(async () => failed('offline')),
    }), credentials())
    failedController.open()
    await vi.waitFor(() => { expect(failedController.store.getSnapshot().error).toBe('offline') })
  })

  it('preserves pending lifecycle transitions and keeps a Host snapshot when credential metadata is absent', async () => {
    const api = remote({
      get: vi.fn(async () => succeeded({ ...DISCONNECTED, credentialConfigured: true })),
    })
    const secret = credentials({
      describe: vi.fn(async () => ({ result: { ok: true, value: { credentials: {} } } }) as never),
    })
    const controller = new ConnectorsPanelController(api, secret)
    controller.store.update((state) => { state.pending = 'connect' })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'connecting' }))
    expect(controller.store.getSnapshot().pending).toBe('connect')
    controller.store.update((state) => { state.pending = 'disconnect' })
    controller.accept(publicSnapshot({ ...DISCONNECTED, status: 'disconnecting' }))
    expect(controller.store.getSnapshot().pending).toBe('disconnect')
    controller.open()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().connector.credentialConfigured).toBe(true)
    })
    expect(controller.store.getSnapshot().connector.credentialConfigured).toBe(true)
  })

  it('merges a public pushed event without inventing or erasing credential metadata', () => {
    const controller = new ConnectorsPanelController(remote(), credentials())
    setCredential(controller)
    controller.accept(publicSnapshot(DISCONNECTED))
    const event: TencentDocsConnectorEventSnapshot = {
      status: 'reconnecting',
      toolCount: 2,
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-08-25T00:00:01.000Z',
    }
    controller.accept(event)
    expect(controller.store.getSnapshot().connector).toMatchObject({
      status: 'reconnecting',
      toolCount: 2,
      credentialConfigured: true,
      credentialSource: 'file',
      credentialWritable: true,
    })
  })

  it('drops late connect, disconnect, and refresh failures after disposal', async () => {
    let rejectConnect: ((error: unknown) => void) | undefined
    const connectingRemote = remote({
      connect: vi.fn(() => new Promise<ConnectorResult>((_resolve, reject) => { rejectConnect = reject })),
    })
    const connecting = new ConnectorsPanelController(connectingRemote, credentials())
    setCredential(connecting)
    const connectWork = connecting.connect()
    await vi.waitFor(() => { expect(connectingRemote.connect).toHaveBeenCalledOnce() })
    connecting.dispose()
    rejectConnect?.(new Error('late connect'))
    await connectWork
    expect(connecting.store.getSnapshot().error).toBeNull()

    let rejectDisconnect: ((error: unknown) => void) | undefined
    const disconnectingRemote = remote({
      disconnect: vi.fn(() => new Promise<ConnectorResult>((_resolve, reject) => { rejectDisconnect = reject })),
    })
    const disconnecting = new ConnectorsPanelController(disconnectingRemote, credentials())
    const disconnectWork = disconnecting.disconnect()
    await vi.waitFor(() => { expect(disconnectingRemote.disconnect).toHaveBeenCalledOnce() })
    disconnecting.dispose()
    rejectDisconnect?.(new Error('late disconnect'))
    await disconnectWork
    expect(disconnecting.store.getSnapshot().error).toBeNull()

    let rejectGet: ((error: unknown) => void) | undefined
    const refreshingRemote = remote({
      get: vi.fn(() => new Promise<ConnectorResult>((_resolve, reject) => { rejectGet = reject })),
    })
    const refreshing = new ConnectorsPanelController(refreshingRemote, credentials())
    refreshing.open()
    refreshing.dispose()
    rejectGet?.(new Error('late refresh'))
    await Promise.resolve()
    expect(refreshing.store.getSnapshot().error).toBeNull()

    const publicResult = deferred<PublicConnectorResult>()
    const publicRefreshing = new ConnectorsPanelController(remote({
      publicGet: vi.fn(() => publicResult.promise),
    }), undefined)
    publicRefreshing.open()
    publicRefreshing.dispose()
    publicResult.resolve(publicSucceeded(publicSnapshot({ ...DISCONNECTED, status: 'connected' })))
    await Promise.resolve()
    expect(publicRefreshing.store.getSnapshot().connector.status).toBe('disconnected')

    const publicFailure = deferred<PublicConnectorResult>()
    const failingPublicRefresh = new ConnectorsPanelController(remote({
      publicGet: vi.fn(() => publicFailure.promise),
    }), undefined)
    failingPublicRefresh.open()
    failingPublicRefresh.dispose()
    publicFailure.reject(new Error('late public refresh'))
    await Promise.resolve()
    expect(failingPublicRefresh.store.getSnapshot().error).toBeNull()
  })

  it('normalizes a non-Error transport rejection into a visible message', async () => {
    const controller = new ConnectorsPanelController(remote({
      // The controller normalizes hostile transport rejections that are not Error objects.
      get: vi.fn(() => Promise.reject('wire unavailable')),
    }), credentials())
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().error).toBe('wire unavailable') })
  })

  it('reports only the newest credential refresh failure', async () => {
    const staleRead = deferred<Awaited<ReturnType<IApiClient['credentials']['describe']>>>()
    const newestRead = deferred<Awaited<ReturnType<IApiClient['credentials']['describe']>>>()
    const describe = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true, value: { credentials: {} } } })
      .mockImplementationOnce(() => staleRead.promise)
      .mockImplementationOnce(() => newestRead.promise)
    const controller = new ConnectorsPanelController(remote(), credentials({ describe }))
    controller.open()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledOnce() })
    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    controller.credentialsUpdated(TENCENT_DOCS_CREDENTIAL_REF)
    staleRead.reject(new Error('stale credential failure'))
    await Promise.resolve()
    expect(controller.store.getSnapshot().error).toBeNull()
    newestRead.reject(new Error('current credential failure'))
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().error).toBe('current credential failure')
    })
  })
})
