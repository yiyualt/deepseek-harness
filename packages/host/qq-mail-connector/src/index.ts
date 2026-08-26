/** Personal QQ Mail credentials, IMAP reads, and SMTP sends. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject } from 'imapflow'
import nodemailer from 'nodemailer'
import PostalMime, { type Address } from 'postal-mime'
import type {
  QqMailConnectorEventSnapshot,
  QqMailConnectorSnapshot,
  QqMailConnectorStatus,
} from './types.ts'

export type * from './types.ts'

/** Credential reference containing the personal QQ Mail address. */
export const QQ_MAIL_EMAIL_REF: CredentialRef = credentialRef('QQ_MAIL_EMAIL')

/** Credential reference containing the QQ Mail IMAP/SMTP authorization code. */
export const QQ_MAIL_AUTHORIZATION_CODE_REF: CredentialRef = credentialRef('QQ_MAIL_AUTHORIZATION_CODE')

/** Number of personal-mail tools activated after credential verification. */
export const QQ_MAIL_TOOL_COUNT = 4

/** Personal QQ Mail network and result bounds. */
export interface Config {
  /** QQ Mail IMAP hostname. */
  imapHost: string
  /** QQ Mail implicit-TLS IMAP port. */
  imapPort: number
  /** Whether the IMAP socket starts with TLS. */
  imapSecure: boolean
  /** QQ Mail SMTP hostname. */
  smtpHost: string
  /** QQ Mail implicit-TLS SMTP port. */
  smtpPort: number
  /** Whether the SMTP socket starts with TLS. */
  smtpSecure: boolean
  /** Complete connection and command inactivity budget. */
  operationTimeoutMs: number
  /** Maximum source bytes accepted for one read message. */
  maxMessageBytes: number
  /** Maximum characters returned from each text or HTML body. */
  maxBodyChars: number
}

/** Validated personal QQ Mail connector configuration. */
export const Config: Schema<Config> = Schema.object({
  imapHost: Schema.string().default('imap.qq.com'),
  imapPort: Schema.number().min(1).max(65_535).default(993),
  imapSecure: Schema.boolean().default(true),
  smtpHost: Schema.string().default('smtp.qq.com'),
  smtpPort: Schema.number().min(1).max(65_535).default(465),
  smtpSecure: Schema.boolean().default(true),
  operationTimeoutMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
  maxMessageBytes: Schema.number().min(1).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  maxBodyChars: Schema.number().min(1).max(4 * 1024 * 1024).default(200_000),
})

type FailureCode = 'CREDENTIAL_MISSING' | 'AUTH_REJECTED' | 'CONNECTION_FAILED'

interface Failure {
  readonly errorCode: FailureCode
  readonly errorMessage: string
}

const FAILURES = {
  credentialMissing: {
    errorCode: 'CREDENTIAL_MISSING',
    errorMessage: 'A QQ Mail address and authorization code are required.',
  },
  authRejected: {
    errorCode: 'AUTH_REJECTED',
    errorMessage: 'QQ Mail rejected the address or authorization code.',
  },
  connectionFailed: {
    errorCode: 'CONNECTION_FAILED',
    errorMessage: 'QQ Mail could not be reached. Try again later.',
  },
} as const satisfies Record<string, Failure>

const NO_FAILURE = { errorCode: null, errorMessage: null } as const
const QQ_MAIL_ADDRESS = /^[^\s@]+@qq\.com$/iu

interface Credentials {
  readonly email: string
  readonly authorizationCode: string
}

interface MessageSummary {
  readonly uid: number
  readonly subject: string
  readonly from: readonly string[]
  readonly to: readonly string[]
  readonly date: string | null
  readonly unread: boolean
  readonly hasAttachments: boolean
}

class AuthenticationFailure extends Error {}

function validateConfig(config: Config): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.trim() === '') throw new Error(`qq-mail-connector: ${key} must be nonempty`)
    if (typeof value === 'number' && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`qq-mail-connector: ${key} must be a positive integer`)
    }
  }
}

function addresses(values: readonly MessageAddressObject[] | undefined): string[] {
  return values?.map(value => value.name === undefined
    ? (value.address ?? '')
    : `${value.name} <${value.address ?? ''}>`).filter(Boolean) ?? []
}

function parsedAddresses(values: readonly Address[] | undefined): string[] {
  if (values === undefined) return []
  return values.flatMap((value) => {
    if (value.group !== undefined) return value.group.map(member => `${member.name} <${member.address}>`)
    return [value.name === '' ? value.address : `${value.name} <${value.address}>`]
  })
}

function containsAttachment(node: MessageStructureObject | undefined): boolean {
  if (node === undefined) return false
  if (node.disposition?.toLowerCase() === 'attachment') return true
  return node.childNodes?.some(containsAttachment) ?? false
}

function summary(message: FetchMessageObject): MessageSummary {
  const date = message.envelope?.date ?? message.internalDate
  return {
    uid: message.uid,
    subject: message.envelope?.subject ?? '',
    from: addresses(message.envelope?.from),
    to: addresses(message.envelope?.to),
    date: date instanceof Date ? date.toISOString() : typeof date === 'string' ? date : null,
    unread: !(message.flags?.has('\\Seen') ?? false),
    hasAttachments: containsAttachment(message.bodyStructure),
  }
}

function bounded(value: string | undefined, limit: number): string {
  if (value === undefined) return ''
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`
}

function isAuthenticationFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const value = error as { authenticationFailed?: unknown; code?: unknown; responseStatus?: unknown }
  return value.authenticationFailed === true || value.code === 'EAUTH' || value.responseStatus === 'NO'
}

/** Remote service and same-process provider for personal QQ Mail operations. */
export class QqMailConnectorGateway extends TypertRemoteService {
  static inject = ['credentials']
  static Config: Schema<Config> = Config

  private snapshotValue: QqMailConnectorEventSnapshot = {
    status: 'disconnected',
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  }

  private readonly activeCalls = new Set<Promise<void>>()
  private operations: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param ctx - Host context carrying the credential provider.
   * @param config - Validated QQ Mail network and result bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'qqMailConnector')
    validateConfig(config)
    ctx.effect(() => async () => {
      this.disposed = true
      await this.operations
      await Promise.allSettled([...this.activeCalls])
    }, 'qq-mail-connector: operation teardown')
  }

  /**
   * Read lifecycle and value-free credential metadata for the loopback UI.
   * @returns Current connector state and credential availability.
   */
  @Remote('get')
  async get(): Promise<QqMailConnectorSnapshot> {
    const [email, authorizationCode] = await Promise.all([
      this.ctx.credentials.describe(QQ_MAIL_EMAIL_REF),
      this.ctx.credentials.describe(QQ_MAIL_AUTHORIZATION_CODE_REF),
    ])
    const sources = new Set([email.source, authorizationCode.source].filter((value): value is string => value !== undefined))
    return {
      ...this.current(),
      credentialConfigured: email.configured && authorizationCode.configured,
      credentialWritable: email.writable && authorizationCode.writable,
      credentialSource: sources.size === 0 ? null : sources.size === 1 ? (Array.from(sources)[0] as string) : 'mixed',
    }
  }

  /**
   * Read credential-free connector state for trusted non-loopback clients.
   * @returns Current credential-free connector state.
   */
  @Remote('publicGet')
  publicGet(): Promise<QqMailConnectorEventSnapshot> { return Promise.resolve(this.current()) }

  /**
   * Verify configured personal QQ Mail credentials over IMAP.
   * @returns State after the verification attempt.
   */
  @Remote('connect')
  connect(): Promise<QqMailConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.disposedSnapshot()
      if (this.snapshotValue.status === 'connected') return this.get()
      this.publish('connecting', 0, NO_FAILURE)
      try {
        const credentials = await this.resolveCredentials()
        await this.withImap(credentials, new AbortController().signal, () => Promise.resolve(undefined), true)
        this.publish('connected', QQ_MAIL_TOOL_COUNT, NO_FAILURE)
      } catch (error: unknown) {
        this.publishFailure(this.connectionFailure(error))
      }
      return this.isDisposed() ? this.disposedSnapshot() : this.get()
    })
  }

  /**
   * Withdraw personal-mail tools after active operations settle.
   * @returns Disconnected state; the loopback UI removes writable credentials separately.
   */
  @Remote('disconnect')
  disconnect(): Promise<QqMailConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.disposedSnapshot()
      this.publish('disconnecting', 0, NO_FAILURE)
      await Promise.allSettled([...this.activeCalls])
      this.publish('disconnected', 0, NO_FAILURE)
      return this.get()
    })
  }

  /**
   * Read the state used by the same-process tool Consumer.
   * @returns Current credential-free in-process state.
   */
  current(): QqMailConnectorEventSnapshot { return { ...this.snapshotValue } }

  /**
   * List the newest messages in the personal inbox.
   * @param limit - Maximum message count.
   * @param unreadOnly - Whether to select only messages without the IMAP Seen flag.
   * @param signal - Cancellation signal for the complete operation.
   * @returns Bounded JSON message summaries ordered newest first.
   */
  listMessages(limit: number, unreadOnly: boolean, signal: AbortSignal): Promise<JsonValue> {
    return this.withMailCall(signal, async credentials => this.withImap(credentials, signal, async (client) => {
      const mailbox = await client.mailboxOpen('INBOX')
      if (mailbox.exists === 0) return []
      const ids = unreadOnly ? await client.search({ seen: false }, { uid: true }) : undefined
      const selected = ids === undefined ? undefined : (ids === false ? [] : ids.slice(-limit))
      const query = { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true }
      const messages = selected === undefined
        ? await client.fetchAll(`${Math.max(1, mailbox.exists - limit + 1)}:*`, query)
        : selected.length === 0 ? [] : await client.fetchAll(selected, query, { uid: true })
      return messages.map(summary).reverse() as unknown as JsonValue
    }))
  }

  /**
   * Search subject, sender, and body text in the personal inbox.
   * @param query - Nonempty search text.
   * @param limit - Maximum message count.
   * @param signal - Cancellation signal for the complete operation.
   * @returns Bounded JSON message summaries ordered newest first.
   */
  searchMessages(query: string, limit: number, signal: AbortSignal): Promise<JsonValue> {
    return this.withMailCall(signal, async credentials => this.withImap(credentials, signal, async (client) => {
      await client.mailboxOpen('INBOX')
      const ids = await client.search({ or: [{ subject: query }, { from: query }, { body: query }] }, { uid: true })
      const selected = ids === false ? [] : ids.slice(-limit)
      if (selected.length === 0) return []
      const messages = await client.fetchAll(selected, {
        uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true,
      }, { uid: true })
      return messages.map(summary).reverse() as unknown as JsonValue
    }))
  }

  /**
   * Read one personal inbox message by IMAP UID.
   * @param uid - Positive IMAP UID in Inbox.
   * @param signal - Cancellation signal for the complete operation.
   * @returns Parsed headers and bounded bodies without attachment content.
   */
  readMessage(uid: number, signal: AbortSignal): Promise<JsonValue> {
    return this.withMailCall(signal, async credentials => this.withImap(credentials, signal, async (client) => {
      await client.mailboxOpen('INBOX')
      const message = await client.fetchOne(uid, { uid: true, source: true }, { uid: true })
      if (message === false || message.source === undefined) throw new Error('QQ Mail message was not found')
      if (message.source.byteLength > this.config.maxMessageBytes) throw new Error('QQ Mail message exceeds the configured byte limit')
      const parsed = await PostalMime.parse(message.source, { maxNestingDepth: 30, maxHeadersSize: 256 * 1024 })
      return {
        uid,
        subject: parsed.subject ?? '',
        from: parsed.from === undefined ? [] : parsedAddresses([parsed.from]),
        to: parsedAddresses(parsed.to),
        cc: parsedAddresses(parsed.cc),
        date: parsed.date ?? null,
        text: bounded(parsed.text, this.config.maxBodyChars),
        html: bounded(parsed.html, this.config.maxBodyChars),
        attachments: parsed.attachments.map(attachment => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          disposition: attachment.disposition,
        })),
      }
    }))
  }

  /**
   * Send one plain-text message from the configured personal QQ mailbox.
   * @param recipients - Validated recipient addresses.
   * @param subject - Reviewed message subject.
   * @param body - Reviewed plain-text message body.
   * @param signal - Cancellation signal for the complete operation.
   * @returns SMTP message id and accepted or rejected recipients.
   */
  sendMessage(recipients: readonly string[], subject: string, body: string, signal: AbortSignal): Promise<JsonValue> {
    return this.withMailCall(signal, async (credentials) => {
      const transport = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        auth: { user: credentials.email, pass: credentials.authorizationCode },
        connectionTimeout: this.config.operationTimeoutMs,
        greetingTimeout: this.config.operationTimeoutMs,
        socketTimeout: this.config.operationTimeoutMs,
      })
      const abort = (): void => { transport.close() }
      signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await transport.sendMail({ from: credentials.email, to: [...recipients], subject, text: body })
        if (signal.aborted) throw new Error('QQ Mail operation was cancelled')
        return { messageId: result.messageId, accepted: result.accepted.map(String), rejected: result.rejected.map(String) }
      } catch (error: unknown) {
        if (isAuthenticationFailure(error)) this.rejectAuthentication()
        throw new Error(signal.aborted ? 'QQ Mail operation was cancelled' : 'QQ Mail send failed')
      } finally {
        signal.removeEventListener('abort', abort)
        transport.close()
      }
    })
  }

  /** Complete tool-call budget exported to scoped tool metadata. */
  get toolCallTimeoutMs(): number { return this.config.operationTimeoutMs }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(() => {}, () => {})
    return result
  }

  private async withMailCall<T extends JsonValue>(signal: AbortSignal, operation: (credentials: Credentials) => Promise<T>): Promise<T> {
    const settled = Promise.withResolvers<void>()
    this.activeCalls.add(settled.promise)
    try {
      if (this.disposed || this.snapshotValue.status !== 'connected') throw new Error('QQ Mail is not connected')
      if (signal.aborted) throw new Error('QQ Mail operation was cancelled')
      return await operation(await this.resolveCredentials())
    } finally {
      settled.resolve()
      this.activeCalls.delete(settled.promise)
    }
  }

  private async resolveCredentials(): Promise<Credentials> {
    const [email, authorizationCode] = await Promise.all([
      this.ctx.credentials.resolve(QQ_MAIL_EMAIL_REF),
      this.ctx.credentials.resolve(QQ_MAIL_AUTHORIZATION_CODE_REF),
    ])
    if (email === undefined || authorizationCode === undefined) throw new Error('CREDENTIAL_MISSING')
    const normalizedEmail = email.value.trim().toLowerCase()
    if (!QQ_MAIL_ADDRESS.test(normalizedEmail)) throw new Error('CREDENTIAL_MISSING')
    return { email: normalizedEmail, authorizationCode: authorizationCode.value }
  }

  private async withImap<T>(
    credentials: Credentials,
    signal: AbortSignal,
    operation: (client: ImapFlow) => Promise<T>,
    verifyOnly = false,
  ): Promise<T> {
    const client = new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: this.config.imapSecure,
      auth: { user: credentials.email, pass: credentials.authorizationCode },
      logger: false,
      verifyOnly,
      disableAutoIdle: true,
      connectionTimeout: this.config.operationTimeoutMs,
      greetingTimeout: this.config.operationTimeoutMs,
      socketTimeout: this.config.operationTimeoutMs,
      maxLiteralSize: this.config.maxMessageBytes,
      maxResponseSize: this.config.maxMessageBytes + 1024 * 1024,
    })
    const abort = (): void => { client.close() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await client.connect()
      return await operation(client)
    } catch (error: unknown) {
      if (isAuthenticationFailure(error)) this.rejectAuthentication()
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      try {
        await client.logout()
      } catch {
        client.close()
      }
    }
  }

  private connectionFailure(error: unknown): Failure {
    if (error instanceof Error && error.message === 'CREDENTIAL_MISSING') return FAILURES.credentialMissing
    if (error instanceof AuthenticationFailure || isAuthenticationFailure(error)) return FAILURES.authRejected
    return FAILURES.connectionFailed
  }

  private rejectAuthentication(): never {
    this.publish('failed', 0, FAILURES.authRejected)
    throw new AuthenticationFailure('QQ Mail rejected the configured authorization code')
  }

  private publishFailure(failure: Failure): void {
    if (!this.disposed) this.publish('failed', 0, failure)
  }

  private isDisposed(): boolean { return this.disposed }

  private disposedSnapshot(): QqMailConnectorSnapshot {
    return {
      ...this.current(),
      credentialConfigured: false,
      credentialWritable: false,
      credentialSource: null,
    }
  }

  private publish(
    status: QqMailConnectorStatus,
    toolCount: number,
    failure: { readonly errorCode: string | null; readonly errorMessage: string | null },
  ): void {
    this.snapshotValue = { status, toolCount, ...failure, updatedAt: new Date().toISOString() }
    this.ctx.emit('qq-mail-connector/change', this.current())
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Personal QQ Mail credential verification and mail operations. */
    qqMailConnector: QqMailConnectorGateway
  }
}

export default QqMailConnectorGateway
