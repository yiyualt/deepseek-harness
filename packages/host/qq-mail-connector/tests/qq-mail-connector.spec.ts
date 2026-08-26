/** Personal QQ Mail gateway behavior with deterministic protocol clients. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider, { type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'

const protocol = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  close: vi.fn(),
  mailboxOpen: vi.fn<() => Promise<{ exists: number }>>(async () => ({ exists: 2 })),
  search: vi.fn<() => Promise<number[] | false>>(async () => [11, 12]),
  fetchAll: vi.fn<() => Promise<Array<Record<string, unknown>>>>(async () => [
    { uid: 11, envelope: { subject: 'one', from: [{ address: 'a@example.com' }], to: [{ address: 'me@qq.com' }] }, flags: new Set(), internalDate: new Date('2026-08-26T00:00:00Z') },
    { uid: 12, envelope: { subject: 'two' }, flags: new Set(['\\Seen']), bodyStructure: { type: 'text/plain', disposition: 'attachment' } },
  ]),
  fetchOne: vi.fn<() => Promise<false | { uid: number; source?: Buffer }>>(async () => ({ uid: 12, source: Buffer.from('message') })),
  sendMail: vi.fn<() => Promise<{ messageId: string; accepted: unknown[]; rejected: unknown[] }>>(async () => ({ messageId: 'sent-1', accepted: ['a@example.com'], rejected: [] })),
  transportClose: vi.fn(),
  parse: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({
    subject: 'parsed', from: { name: 'Alice', address: 'a@example.com' }, to: [], cc: [], date: '2026-08-26',
    text: 'body', html: '<p>body</p>', attachments: [{ filename: 'a.txt', mimeType: 'text/plain', disposition: 'attachment' }],
  })),
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    connect = protocol.connect
    logout = protocol.logout
    close = protocol.close
    mailboxOpen = protocol.mailboxOpen
    search = protocol.search
    fetchAll = protocol.fetchAll
    fetchOne = protocol.fetchOne
  },
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: protocol.sendMail, close: protocol.transportClose }) },
}))

vi.mock('postal-mime', () => ({ default: { parse: protocol.parse } }))

import QqMailConnectorGateway, { type Config } from '../src/index.ts'

class MemoryCredentials extends CredentialProvider {
  readonly values = new Map<string, string>()
  readonly sources = new Map<string, string>()
  writable = true
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: this.sources.get(ref) ?? 'test' })
  }
  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve(this.values.has(ref)
      ? { configured: true, source: this.sources.get(ref) ?? 'test', writable: this.writable }
      : { configured: false, writable: this.writable })
  }
  set(ref: CredentialRef, value: string): Promise<void> { this.values.set(ref, value); return Promise.resolve() }
  unset(ref: CredentialRef): Promise<void> { this.values.delete(ref); return Promise.resolve() }
}

const CONFIG: Config = {
  imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
  operationTimeoutMs: 1000, maxMessageBytes: 1024 * 1024, maxBodyChars: 1000,
}

function config(overrides: Partial<Config>): Config {
  return {
    imapHost: CONFIG.imapHost,
    imapPort: CONFIG.imapPort,
    imapSecure: CONFIG.imapSecure,
    smtpHost: CONFIG.smtpHost,
    smtpPort: CONFIG.smtpPort,
    smtpSecure: CONFIG.smtpSecure,
    operationTimeoutMs: CONFIG.operationTimeoutMs,
    maxMessageBytes: CONFIG.maxMessageBytes,
    maxBodyChars: CONFIG.maxBodyChars,
    ...overrides,
  }
}

const contexts: Context[] = []

async function boot(config: Config = CONFIG): Promise<{ ctx: Context; credentials: MemoryCredentials; gateway: QqMailConnectorGateway }> {
  const ctx = new Context()
  contexts.push(ctx)
  const credentials = new MemoryCredentials(ctx)
  await ctx.plugin(QqMailConnectorGateway, config)
  return { ctx, credentials, gateway: ctx.qqMailConnector }
}

function configure(credentials: MemoryCredentials): void {
  credentials.values.set('QQ_MAIL_EMAIL', 'me@qq.com')
  credentials.values.set('QQ_MAIL_AUTHORIZATION_CODE', 'secret-code')
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('personal QQ Mail gateway', () => {
  it('reports missing credentials without exposing values', async () => {
    const { gateway } = await boot()
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CREDENTIAL_MISSING' })
    expect(JSON.stringify(await gateway.get())).not.toContain('secret')
  })

  it('verifies IMAP and publishes four tools', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await expect(gateway.connect()).resolves.toMatchObject({
      status: 'connected', toolCount: 4, credentialConfigured: true, credentialWritable: true, credentialSource: 'test',
    })
    expect(protocol.connect).toHaveBeenCalledOnce()
    expect(gateway.toolCallTimeoutMs).toBe(1000)
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected', toolCount: 4 })
    expect(protocol.connect).toHaveBeenCalledOnce()
    await expect(gateway.publicGet()).resolves.not.toHaveProperty('credentialConfigured')
    await expect(gateway.disconnect()).resolves.toMatchObject({ status: 'disconnected', credentialConfigured: true })
  })

  it('lists, searches, reads, and sends personal messages', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await gateway.connect()
    const signal = new AbortController().signal
    await expect(gateway.listMessages(2, false, signal)).resolves.toEqual([
      expect.objectContaining({ uid: 12, unread: false, hasAttachments: true }),
      expect.objectContaining({ uid: 11, subject: 'one', unread: true }),
    ])
    await expect(gateway.listMessages(1, true, signal)).resolves.toHaveLength(2)
    await expect(gateway.searchMessages('one', 10, signal)).resolves.toHaveLength(2)
    await expect(gateway.readMessage(12, signal)).resolves.toMatchObject({ subject: 'parsed', text: 'body' })
    await expect(gateway.sendMessage(['a@example.com'], 'subject', 'body', signal)).resolves.toEqual({
      messageId: 'sent-1', accepted: ['a@example.com'], rejected: [],
    })
  })

  it('distinguishes rejected authentication and network failures', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    protocol.connect.mockRejectedValueOnce(Object.assign(new Error('auth'), { authenticationFailed: true }))
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
    protocol.connect.mockRejectedValueOnce(new Error('network'))
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED' })
  })

  it('rejects invalid deployment configuration', async () => {
    await expect(boot(config({ imapHost: '' }))).rejects.toThrow(/imapHost must be nonempty/)
    await expect(boot(config({ imapPort: 0 }))).rejects.toThrow(/imapPort expected number >= 1/)
    await expect(boot(config({ imapPort: 1.5 }))).rejects.toThrow(/imapPort must be a positive integer/)
  })

  it('projects absent, mixed, and read-only credential metadata', async () => {
    const { credentials, gateway } = await boot()
    await expect(gateway.get()).resolves.toMatchObject({
      credentialConfigured: false, credentialWritable: true, credentialSource: null,
    })
    configure(credentials)
    credentials.sources.set('QQ_MAIL_EMAIL', 'env')
    credentials.sources.set('QQ_MAIL_AUTHORIZATION_CODE', 'file')
    credentials.writable = false
    await expect(gateway.get()).resolves.toMatchObject({
      credentialConfigured: true, credentialWritable: false, credentialSource: 'mixed',
    })
  })

  it('normalizes address, date, attachment, and bounded-body variants', async () => {
    const { credentials, gateway } = await boot(config({ maxBodyChars: 4 }))
    configure(credentials)
    await gateway.connect()
    protocol.fetchAll.mockResolvedValueOnce([
      {
        uid: 20,
        envelope: {
          subject: undefined,
          from: [{ name: 'Named', address: undefined }, { address: undefined }],
          to: undefined,
          date: '2026-08-26',
        },
        flags: undefined,
        bodyStructure: { childNodes: [{ type: 'text/plain' }, { disposition: 'ATTACHMENT' }] },
      },
      { uid: 21, envelope: undefined, internalDate: undefined, bodyStructure: undefined },
    ])
    await expect(gateway.listMessages(2, false, new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ uid: 21, date: null, hasAttachments: false }),
      expect.objectContaining({ uid: 20, subject: '', date: '2026-08-26', hasAttachments: true }),
    ])
    protocol.parse.mockResolvedValueOnce({
      subject: undefined,
      from: { name: '', address: 'from@example.com' },
      to: undefined,
      cc: [{ name: 'Group', group: [{ name: 'Member', address: 'member@example.com' }] }],
      date: undefined,
      text: undefined,
      html: '123456',
      attachments: [],
    })
    await expect(gateway.readMessage(12, new AbortController().signal)).resolves.toMatchObject({
      subject: '', from: ['from@example.com'], date: null, text: '', html: '1234\n[truncated]',
      to: [],
      cc: ['Member <member@example.com>'],
    })
    protocol.parse.mockResolvedValueOnce({
      subject: 'without from', from: undefined, to: [], cc: [], date: null,
      text: '', html: '', attachments: [],
    })
    await expect(gateway.readMessage(12, new AbortController().signal)).resolves.toMatchObject({ from: [] })
  })

  it('handles empty and false IMAP search results without fetching', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await gateway.connect()
    protocol.mailboxOpen.mockResolvedValueOnce({ exists: 0 })
    await expect(gateway.listMessages(10, false, new AbortController().signal)).resolves.toEqual([])
    protocol.search.mockResolvedValueOnce(false)
    await expect(gateway.listMessages(10, true, new AbortController().signal)).resolves.toEqual([])
    protocol.search.mockResolvedValueOnce(false)
    await expect(gateway.searchMessages('none', 10, new AbortController().signal)).resolves.toEqual([])
  })

  it('rejects missing, invalid, absent, and oversized message inputs safely', async () => {
    const { credentials, gateway } = await boot(config({ maxMessageBytes: 4 }))
    credentials.values.set('QQ_MAIL_EMAIL', 'not-a-qq-address')
    credentials.values.set('QQ_MAIL_AUTHORIZATION_CODE', 'code')
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CREDENTIAL_MISSING' })
    configure(credentials)
    await gateway.connect()
    protocol.fetchOne.mockResolvedValueOnce(false)
    await expect(gateway.readMessage(1, new AbortController().signal)).rejects.toThrow(/not found/)
    protocol.fetchOne.mockResolvedValueOnce({ uid: 1 })
    await expect(gateway.readMessage(1, new AbortController().signal)).rejects.toThrow(/not found/)
    protocol.fetchOne.mockResolvedValueOnce({ uid: 1, source: Buffer.from('oversized') })
    await expect(gateway.readMessage(1, new AbortController().signal)).rejects.toThrow(/byte limit/)
  })

  it('requires a connected, uncancelled call and closes aborted clients', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await expect(gateway.listMessages(1, false, new AbortController().signal)).rejects.toThrow(/not connected/)
    await gateway.connect()
    const controller = new AbortController()
    controller.abort()
    await expect(gateway.listMessages(1, false, controller.signal)).rejects.toThrow(/cancelled/)
  })

  it('normalizes SMTP authentication, network, and cancellation failures', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await gateway.connect()
    protocol.sendMail.mockRejectedValueOnce(Object.assign(new Error('auth'), { code: 'EAUTH' }))
    await expect(gateway.sendMessage(['a@example.com'], 's', 'b', new AbortController().signal)).rejects.toThrow(/rejected/)
    expect(gateway.current()).toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
    await gateway.connect()
    protocol.sendMail.mockRejectedValueOnce(new Error('network'))
    await expect(gateway.sendMessage(['a@example.com'], 's', 'b', new AbortController().signal)).rejects.toThrow(/send failed/)
    const controller = new AbortController()
    protocol.sendMail.mockImplementationOnce(async () => { controller.abort(); return { messageId: 'late', accepted: [], rejected: [] } })
    await expect(gateway.sendMessage(['a@example.com'], 's', 'b', controller.signal)).rejects.toThrow(/cancelled/)
    expect(protocol.transportClose).toHaveBeenCalled()
  })

  it('falls back to hard close when IMAP logout fails and recognizes NO authentication', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    protocol.logout.mockRejectedValueOnce(new Error('logout failed'))
    await gateway.connect()
    expect(protocol.close).toHaveBeenCalled()
    await gateway.disconnect()
    protocol.connect.mockRejectedValueOnce(Object.assign(new Error('auth'), { responseStatus: 'NO' }))
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
  })

  it('closes IMAP immediately when cancellation arrives during an operation', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    await gateway.connect()
    const controller = new AbortController()
    protocol.mailboxOpen.mockImplementationOnce(async () => { controller.abort(); return { exists: 0 } })
    await gateway.listMessages(1, false, controller.signal)
    expect(protocol.close).toHaveBeenCalled()
  })

  it('handles non-Error failures and the queued rejection settlement', async () => {
    const { credentials, gateway } = await boot()
    configure(credentials)
    protocol.connect.mockRejectedValueOnce(null)
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED' })
    const describe = vi.spyOn(credentials, 'describe').mockRejectedValueOnce(new Error('describe failed'))
    await expect(gateway.connect()).rejects.toThrow(/describe failed/)
    describe.mockRestore()
  })

  it('keeps disposal quiescent and ignores late failure publication', async () => {
    const { ctx, credentials, gateway } = await boot()
    configure(credentials)
    const pending = Promise.withResolvers<undefined>()
    protocol.connect.mockImplementationOnce(() => pending.promise)
    const connecting = gateway.connect()
    await vi.waitFor(() => { expect(protocol.connect).toHaveBeenCalledOnce() })
    const disposal = ctx.fiber.dispose()
    pending.reject(new Error('late network failure'))
    await connecting
    await disposal
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connecting', credentialConfigured: false })
    await expect(gateway.disconnect()).resolves.toMatchObject({ status: 'connecting' })
  })
})
