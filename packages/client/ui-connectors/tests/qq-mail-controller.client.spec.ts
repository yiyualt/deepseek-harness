/** Personal QQ Mail controller credential, lifecycle, and stale-settlement behavior. */
import { describe, expect, it, vi } from 'vitest'
import type { QqMailConnectorSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { QqMailConnectorController } from '../src/client/controller.ts'

const DISCONNECTED: QqMailConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: true,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: '2026-08-26T00:00:00.000Z',
}
const CONNECTED: QqMailConnectorSnapshot = {
  ...DISCONNECTED,
  status: 'connected',
  credentialConfigured: true,
  credentialSource: 'file',
  toolCount: 4,
}
const CONNECTED_EVENT = {
  status: CONNECTED.status,
  toolCount: CONNECTED.toolCount,
  errorCode: CONNECTED.errorCode,
  errorMessage: CONNECTED.errorMessage,
  updatedAt: CONNECTED.updatedAt,
}

function rpc(value: unknown) {
  return { result: { ok: true as const, value } }
}

function bench(initial = DISCONNECTED) {
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: initial })),
    publicGet: vi.fn(async () => ({ ok: true as const, value: {
      status: initial.status,
      toolCount: initial.toolCount,
      errorCode: initial.errorCode,
      errorMessage: initial.errorMessage,
      updatedAt: initial.updatedAt,
    } })),
    connect: vi.fn(async () => ({ ok: true as const, value: CONNECTED })),
    disconnect: vi.fn(async () => ({ ok: true as const, value: DISCONNECTED })),
  }
  const credentials = {
    credentials: {
      set: vi.fn(async () => rpc({})),
      unset: vi.fn(async () => rpc({})),
    },
  }
  return { remote, credentials }
}

describe('QqMailConnectorController', () => {
  it('keeps non-loopback pages read-only and accepts credential-free pushes', async () => {
    const { remote } = bench()
    const controller = new QqMailConnectorController(remote, undefined)
    controller.open()
    await vi.waitFor(() => { expect(remote.publicGet).toHaveBeenCalledOnce() })
    controller.setDraft('email', 'ignored@qq.com')
    await controller.connect()
    await controller.disconnect()
    controller.credentialsUpdated('OTHER')
    controller.credentialsUpdated('QQ_MAIL_EMAIL')
    controller.accept(CONNECTED_EVENT)
    expect(controller.store.getSnapshot()).toMatchObject({
      loopback: false,
      emailDraft: '',
      connector: { status: 'connected', toolCount: 4 },
    })
    expect(remote.get).not.toHaveBeenCalled()
    expect(remote.connect).not.toHaveBeenCalled()
    controller.close()
    controller.dispose()
    controller.open()
    controller.accept(CONNECTED_EVENT)
    controller.credentialsUpdated('QQ_MAIL_AUTHORIZATION_CODE')
    await controller.connect()
    await controller.disconnect()
  })

  it('stores both drafts, survives credential refresh pushes, and clears pending', async () => {
    const { remote, credentials } = bench()
    const settled = Promise.withResolvers<ReturnType<typeof rpc>>()
    credentials.credentials.set.mockImplementationOnce(async () => {
      controller.credentialsUpdated('QQ_MAIL_EMAIL')
      return settled.promise
    })
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
    controller.setDraft('email', ' person@qq.com ')
    controller.setDraft('authorizationCode', ' mail-code ')
    const connection = controller.connect()
    expect(controller.store.getSnapshot()).toMatchObject({ pending: 'connect', emailDraft: '', authorizationCodeDraft: '' })
    settled.resolve(rpc({}))
    await connection
    expect(credentials.credentials.set.mock.calls).toEqual([
      [{ ref: 'QQ_MAIL_EMAIL', value: 'person@qq.com' }],
      [{ ref: 'QQ_MAIL_AUTHORIZATION_CODE', value: 'mail-code' }],
    ])
    expect(controller.store.getSnapshot()).toMatchObject({ pending: null, connector: { status: 'connected', toolCount: 4 } })
  })

  it('allows configured credential reuse and reports credential or Remote failures', async () => {
    const { remote, credentials } = bench(CONNECTED)
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
    await controller.connect()
    expect(credentials.credentials.set).not.toHaveBeenCalled()
    expect(remote.connect).toHaveBeenCalledOnce()

    credentials.credentials.set.mockResolvedValueOnce({ result: { ok: false, error: { message: 'credential failed' } } } as never)
    controller.setDraft('email', 'person@qq.com')
    controller.setDraft('authorizationCode', 'code')
    await controller.connect()
    expect(controller.store.getSnapshot()).toMatchObject({ pending: null, error: 'credential failed' })

    remote.connect.mockResolvedValueOnce({ ok: false, error: { message: 'connect failed' } } as never)
    controller.setDraft('email', 'person@qq.com')
    controller.setDraft('authorizationCode', 'code')
    await controller.connect()
    expect(controller.store.getSnapshot().error).toBe('connect failed')
  })

  it('disconnects before deleting writable credentials and refreshes metadata', async () => {
    const { remote, credentials } = bench(CONNECTED)
    remote.get.mockResolvedValueOnce({ ok: true, value: CONNECTED }).mockResolvedValueOnce({ ok: true, value: DISCONNECTED })
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
    await controller.disconnect()
    expect(credentials.credentials.unset.mock.calls).toEqual([
      [{ ref: 'QQ_MAIL_EMAIL' }],
      [{ ref: 'QQ_MAIL_AUTHORIZATION_CODE' }],
    ])
    expect(controller.store.getSnapshot()).toMatchObject({ pending: null, connector: { status: 'disconnected' } })
  })

  it('skips read-only credential deletion and reports disconnect failures', async () => {
    const readOnly = { ...CONNECTED, credentialWritable: false }
    const { remote, credentials } = bench(readOnly)
    remote.disconnect.mockResolvedValueOnce({ ok: true, value: readOnly })
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
    await controller.disconnect()
    expect(credentials.credentials.unset).not.toHaveBeenCalled()

    remote.disconnect.mockResolvedValueOnce({ ok: false, error: { message: 'disconnect failed' } } as never)
    await controller.disconnect()
    expect(controller.store.getSnapshot()).toMatchObject({ pending: null, error: 'disconnect failed' })
  })

  it('ignores incomplete credentials, failed refreshes, and late settlements after disposal', async () => {
    const { remote, credentials } = bench()
    remote.get.mockResolvedValueOnce({ ok: false, error: { message: 'refresh failed' } } as never)
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().error).toBe('refresh failed') })
    controller.setDraft('email', 'only@qq.com')
    await controller.connect()
    expect(remote.connect).not.toHaveBeenCalled()
    controller.close()

    const pending = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
    remote.connect.mockImplementationOnce(() => pending.promise)
    controller.setDraft('email', 'person@qq.com')
    controller.setDraft('authorizationCode', 'code')
    const connection = controller.connect()
    controller.dispose()
    pending.resolve({ ok: true, value: CONNECTED })
    await connection
    expect(controller.store.getSnapshot()).toMatchObject({ emailDraft: '', authorizationCodeDraft: '' })
  })

  it('covers closed credential events, busy calls, and late failed connect settlement', async () => {
    const { remote, credentials } = bench()
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.credentialsUpdated('QQ_MAIL_EMAIL')
    controller.setDraft('authorizationCode', 'only-code')
    await controller.connect()
    expect(remote.connect).not.toHaveBeenCalled()

    const pending = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
    remote.connect.mockImplementationOnce(() => pending.promise)
    controller.setDraft('email', 'person@qq.com')
    controller.setDraft('authorizationCode', 'code')
    const first = controller.connect()
    await controller.connect()
    await controller.disconnect()
    controller.dispose()
    pending.reject(new Error('late secret-free failure'))
    await first
  })

  it('handles failed post-disconnect refresh and stale disconnect settlements', async () => {
    const { remote, credentials } = bench(CONNECTED)
    remote.get.mockResolvedValueOnce({ ok: true, value: CONNECTED })
      .mockResolvedValueOnce({ ok: false, error: { message: 'post-disconnect refresh failed' } } as never)
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
    await controller.disconnect()
    expect(controller.store.getSnapshot().error).toBe('post-disconnect refresh failed')

    const disconnectPending = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
    remote.disconnect.mockImplementationOnce(() => disconnectPending.promise)
    const stale = controller.disconnect()
    controller.dispose()
    disconnectPending.resolve({ ok: true, value: CONNECTED })
    await stale
  })

  it('ignores stale refresh success and failure after a later event', async () => {
    const { remote, credentials } = bench()
    const success = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
    remote.get.mockImplementationOnce(() => success.promise)
    const controller = new QqMailConnectorController(remote, credentials as never)
    controller.open()
    controller.accept(CONNECTED_EVENT)
    success.resolve({ ok: true, value: DISCONNECTED })
    await Promise.resolve()
    expect(controller.store.getSnapshot().connector.status).toBe('connected')

    const failure = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
    remote.get.mockImplementationOnce(() => failure.promise)
    controller.open()
    controller.close()
    failure.reject(new Error('stale refresh'))
    await Promise.resolve()
    expect(controller.store.getSnapshot().error).toBeNull()
  })

  it('ignores post-disconnect refresh settlements after disposal', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
      const { remote, credentials } = bench(CONNECTED)
      const refresh = Promise.withResolvers<{ ok: true; value: QqMailConnectorSnapshot }>()
      remote.get.mockResolvedValueOnce({ ok: true, value: CONNECTED }).mockImplementationOnce(() => refresh.promise)
      const controller = new QqMailConnectorController(remote, credentials as never)
      controller.open()
      await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledOnce() })
      const disconnection = controller.disconnect()
      await vi.waitFor(() => { expect(remote.get).toHaveBeenCalledTimes(2) })
      controller.dispose()
      if (outcome === 'resolve') refresh.resolve({ ok: true, value: DISCONNECTED })
      else refresh.reject(new Error('late refresh failure'))
      await disconnection
    }
  })
})
