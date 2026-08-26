/** Kingsoft Docs browser login and authenticated `kdocs-cli` execution. */

import { Buffer } from 'node:buffer'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  KingsoftDocsConnectorEventSnapshot,
  KingsoftDocsConnectorSnapshot,
  KingsoftDocsConnectorStatus,
} from './types.ts'

export type * from './types.ts'

/** Executable resolved in the Host execution world by default. */
export const DEFAULT_KDOCS_CLI_COMMAND = 'kdocs-cli'

/** Number of scoped Harness tools activated after browser login. */
export const KINGSOFT_DOCS_TOOL_COUNT = 2

/** `kdocs-cli` service names exposed through the generic action bridge. */
export const KDOCS_CLI_SERVICES = [
  'drive',
  'sheet',
  'otl',
  'dbsheet',
  'form',
  'wpp',
  'aippt',
  'wps',
  'pdf',
  'kwiki',
] as const

/** One supported `kdocs-cli` service. */
export type KdocsCliService = typeof KDOCS_CLI_SERVICES[number]

/** Authenticated CLI action request from the scoped tool Consumer. */
export interface KdocsCliActionRequest {
  /** Current CLI service name. */
  readonly service: KdocsCliService
  /** Current kebab-case action name reported by CLI help. */
  readonly action: string
  /** JSON object passed to the CLI over stdin. */
  readonly params: Readonly<Record<string, JsonValue>>
  /** Cancellation owned by the calling tool execution. */
  readonly signal: AbortSignal
}

/** CLI lifecycle and bounded-I/O configuration. */
export interface Config {
  /** Command or absolute executable path resolved in the Host execution world. */
  command: string
  /** Complete browser-login process budget, including termination grace. */
  loginTimeoutMs: number
  /** Complete budget for status, logout, and help commands. */
  commandTimeoutMs: number
  /** Complete budget for one authenticated document operation. */
  toolCallTimeoutMs: number
  /** TERM-to-KILL grace for each owned CLI process tree. */
  processGraceMs: number
  /** Maximum UTF-8 byte count accepted for one tool parameter object. */
  maxInputBytes: number
  /** Maximum UTF-8 byte count retained from one CLI output stream. */
  maxOutputBytes: number
}

/** Validated Kingsoft Docs CLI connector configuration. */
export const Config: Schema<Config> = Schema.object({
  command: Schema.string().default(DEFAULT_KDOCS_CLI_COMMAND),
  loginTimeoutMs: Schema.number().min(2).max(MAX_TIMER_DELAY_MS).default(300_000),
  commandTimeoutMs: Schema.number().min(2).max(MAX_TIMER_DELAY_MS).default(30_000),
  toolCallTimeoutMs: Schema.number().min(2).max(MAX_TIMER_DELAY_MS).default(60_000),
  processGraceMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(1_000),
  maxInputBytes: Schema.number().min(1).max(16 * 1024 * 1024).default(1024 * 1024),
  maxOutputBytes: Schema.number().min(1).max(16 * 1024 * 1024).default(1024 * 1024),
})

type FailureCode =
  | 'CLI_NOT_FOUND'
  | 'CLI_INCOMPATIBLE'
  | 'LOGIN_FAILED'
  | 'LOGIN_TIMEOUT'
  | 'AUTH_REJECTED'
  | 'DISCONNECT_FAILED'

interface Failure {
  readonly errorCode: FailureCode
  readonly errorMessage: string
}

const FAILURES = {
  cliNotFound: {
    errorCode: 'CLI_NOT_FOUND',
    errorMessage: 'kdocs-cli is not installed or is not available on PATH.',
  },
  cliIncompatible: {
    errorCode: 'CLI_INCOMPATIBLE',
    errorMessage: 'kdocs-cli returned an unsupported response. Install or upgrade the official CLI.',
  },
  loginFailed: {
    errorCode: 'LOGIN_FAILED',
    errorMessage: 'Kingsoft Docs browser login did not complete. Try again.',
  },
  loginTimeout: {
    errorCode: 'LOGIN_TIMEOUT',
    errorMessage: 'Kingsoft Docs browser login timed out. Try again.',
  },
  authRejected: {
    errorCode: 'AUTH_REJECTED',
    errorMessage: 'The Kingsoft Docs login expired. Sign in again.',
  },
  disconnectFailed: {
    errorCode: 'DISCONNECT_FAILED',
    errorMessage: 'Unable to remove the Kingsoft Docs login from the system keychain.',
  },
} as const satisfies Record<string, Failure>

const NO_FAILURE = { errorCode: null, errorMessage: null } as const
const ACTION_NAME = /^[a-z][a-z0-9-]*$/

type CliFailureKind = 'not-found' | 'timeout' | 'cancelled' | 'failed' | 'too-large'

class CliFailure extends Error {
  constructor(readonly kind: CliFailureKind) {
    super(`kdocs-cli ${kind}`)
    this.name = 'CliFailure'
  }
}

interface CliResult {
  readonly outcome: SubprocessOutcome
  readonly stdout: string
}

interface AuthStatus {
  readonly authenticated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonCode(value: JsonValue): string | number | undefined {
  if (!isRecord(value)) return undefined
  const code = value.code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function isAuthenticationRejection(value: JsonValue): boolean {
  const code = jsonCode(value)
  return code === 400006 || code === '400006'
}

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue
}

function parseAuthStatus(text: string): AuthStatus {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || typeof value.authenticated !== 'boolean') {
    throw new TypeError('missing authenticated boolean')
  }
  return { authenticated: value.authenticated }
}

function validateConfig(config: Config): void {
  if (config.command.trim() === '') throw new Error('kingsoft-docs-connector: command must be nonempty')
  for (const [name, value] of Object.entries(config)) {
    if (name === 'command') continue
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`kingsoft-docs-connector: ${name} must be a positive integer`)
    }
  }
  for (const [name, value] of [
    ['loginTimeoutMs', config.loginTimeoutMs],
    ['commandTimeoutMs', config.commandTimeoutMs],
    ['toolCallTimeoutMs', config.toolCallTimeoutMs],
  ] as const) {
    if (value <= config.processGraceMs) {
      throw new Error(`kingsoft-docs-connector: ${name} must exceed processGraceMs`)
    }
  }
}

/** Remote service and same-process provider for authenticated Kingsoft Docs CLI operations. */
export class KingsoftDocsConnectorGateway extends TypertRemoteService {
  static inject = ['subprocess']
  static Config: Schema<Config> = Config

  private snapshotValue: KingsoftDocsConnectorSnapshot = {
    status: 'disconnected',
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  }

  private readonly lifetime = new AbortController()
  private readonly activeCalls = new Set<Promise<void>>()
  private operations: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param ctx - Host context carrying the subprocess execution world.
   * @param config - validated CLI command and process budgets.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'kingsoftDocsConnector')
    validateConfig(config)
    ctx.effect(() => async () => {
      this.disposed = true
      this.lifetime.abort()
      await this.operations
      await Promise.allSettled([...this.activeCalls])
    }, 'kingsoft-docs-connector: CLI teardown')
  }

  /**
   * Read the complete credential-free connector state.
   * @returns a detached snapshot of the current login lifecycle.
   */
  @Remote('get')
  get(): Promise<KingsoftDocsConnectorSnapshot> {
    return Promise.resolve(this.current())
  }

  /**
   * Read the connector state approved for trusted non-loopback Web clients.
   * @returns a detached snapshot containing only credential-free fields.
   */
  @Remote('publicGet')
  publicGet(): Promise<KingsoftDocsConnectorEventSnapshot> {
    return Promise.resolve(this.current())
  }

  /**
   * Reuse an existing keychain login or open the official browser authorization flow.
   * @returns the settled connector state after authentication is verified.
   */
  @Remote('connect')
  connect(): Promise<KingsoftDocsConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed || this.snapshotValue.status === 'connected') return this.current()
      this.publish('connecting', 0, NO_FAILURE)
      try {
        const before = await this.readAuthStatus()
        if (!before.authenticated) {
          const result = await this.runCli([
            'auth',
            'login',
            '--oauth-timeout',
            String(this.config.loginTimeoutMs - this.config.processGraceMs),
          ], undefined, this.config.loginTimeoutMs)
          if (result.outcome.exitCode !== 0) throw new CliFailure('failed')
        }
        const after = await this.readAuthStatus()
        if (!after.authenticated) throw new CliFailure('failed')
        this.publish('connected', KINGSOFT_DOCS_TOOL_COUNT, NO_FAILURE)
      } catch (error: unknown) {
        this.publishFailureUnlessDisposed(this.connectFailure(error))
      }
      return this.current()
    })
  }

  /**
   * Remove the saved login from the system keychain after active CLI calls settle.
   * @returns the settled connector state after logout.
   */
  @Remote('disconnect')
  disconnect(): Promise<KingsoftDocsConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.current()
      this.publish('disconnecting', 0, NO_FAILURE)
      await Promise.allSettled([...this.activeCalls])
      try {
        const result = await this.runCli(['auth', 'logout'], undefined, this.config.commandTimeoutMs)
        if (result.outcome.exitCode !== 0) throw new CliFailure('failed')
        const status = await this.readAuthStatus()
        if (status.authenticated) throw new CliFailure('failed')
        this.publish('disconnected', 0, NO_FAILURE)
      } catch {
        this.publishFailureUnlessDisposed(FAILURES.disconnectFailed)
      }
      return this.current()
    })
  }

  /**
   * Read the current in-process state without starting authentication work.
   * @returns a detached credential-free snapshot.
   */
  current(): KingsoftDocsConnectorSnapshot {
    return { ...this.snapshotValue }
  }

  /**
   * Render current CLI help for the scoped model tool without contacting the document API.
   * @param service - optional supported service to inspect.
   * @param action - optional action under `service` to inspect.
   * @param signal - cancellation owned by the calling tool execution.
   * @returns bounded help text from the installed CLI.
   */
  runHelp(service: KdocsCliService | undefined, action: string | undefined, signal: AbortSignal): Promise<string> {
    return this.withActiveCall(async () => {
      this.assertConnected()
      if (action !== undefined && service === undefined) {
        throw new TypeError('Kingsoft Docs action help requires a service')
      }
      if (action !== undefined) this.assertAction(action)
      const argv = service === undefined
        ? ['--help']
        : action === undefined ? [service, '--help'] : [service, action, '--help']
      const result = await this.runCli(argv, undefined, this.config.commandTimeoutMs, signal)
      if (result.outcome.exitCode !== 0) throw new Error('kdocs-cli could not render help')
      return result.stdout
    })
  }

  /**
   * Execute one authenticated document operation through the official CLI.
   * @param request - validated service, action, JSON params, and caller cancellation.
   * @returns the CLI's parsed JSON result.
   */
  runAction(request: KdocsCliActionRequest): Promise<JsonValue> {
    return this.withActiveCall(async () => {
      this.assertConnected()
      this.assertAction(request.action)
      const input = JSON.stringify(request.params)
      if (Buffer.byteLength(input, 'utf8') > this.config.maxInputBytes) {
        throw new Error('Kingsoft Docs tool parameters exceed the configured byte limit')
      }
      const result = await this.runCli([
        request.service,
        request.action,
        '-',
        '--output',
        'json',
        '--timeout',
        String(this.config.toolCallTimeoutMs - this.config.processGraceMs),
      ], input, this.config.toolCallTimeoutMs, request.signal)
      if (result.outcome.exitCode !== 0) throw new Error('Kingsoft Docs command failed')
      let value: JsonValue
      try {
        value = parseJson(result.stdout)
      } catch {
        throw new Error('Kingsoft Docs returned invalid JSON')
      }
      if (isAuthenticationRejection(value)) {
        if (this.snapshotValue.status === 'connected') {
          this.publish('failed', 0, FAILURES.authRejected)
        }
        throw new Error('Kingsoft Docs login expired. Sign in again.')
      }
      const code = jsonCode(value)
      if (code !== undefined && code !== 0 && code !== '0') {
        throw new Error(`Kingsoft Docs operation failed with code ${String(code)}`)
      }
      return value
    })
  }

  /** Complete tool-call budget exported to the scoped Consumer's timeout metadata. */
  get toolCallTimeoutMs(): number {
    return this.config.toolCallTimeoutMs
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(() => {}, () => {})
    return result
  }

  private async withActiveCall<T>(operation: () => Promise<T>): Promise<T> {
    const settled = Promise.withResolvers<void>()
    this.activeCalls.add(settled.promise)
    try {
      return await operation()
    } finally {
      settled.resolve()
      this.activeCalls.delete(settled.promise)
    }
  }

  private assertConnected(): void {
    if (this.disposed || this.snapshotValue.status !== 'connected') {
      throw new Error('Kingsoft Docs is not connected')
    }
  }

  private assertAction(action: string): void {
    if (!ACTION_NAME.test(action)) throw new TypeError('Kingsoft Docs action must be a kebab-case CLI name')
  }

  private async readAuthStatus(): Promise<AuthStatus> {
    const result = await this.runCli(['auth', 'status', '--compact'], undefined, this.config.commandTimeoutMs)
    if (result.outcome.exitCode !== 0) throw new CliFailure('failed')
    try {
      return parseAuthStatus(result.stdout)
    } catch {
      throw new CliFailure('failed')
    }
  }

  private async runCli(
    argv: readonly string[],
    stdin: string | undefined,
    timeoutMs: number,
    callerSignal?: AbortSignal,
  ): Promise<CliResult> {
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort() }, timeoutMs)
    const signal = AbortSignal.any([
      this.lifetime.signal,
      deadline.signal,
      ...callerSignal === undefined ? [] : [callerSignal],
    ])
    let executable: string
    try {
      executable = await this.ctx.subprocess.resolveExecutable(this.config.command, undefined, signal)
    } catch {
      clearTimeout(timer)
      if (signal.aborted) throw new CliFailure(deadline.signal.aborted ? 'timeout' : 'cancelled')
      throw new CliFailure('not-found')
    }

    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [executable, ...argv],
        cwd: process.cwd(),
        stdio: {
          stdin: stdin === undefined ? 'ignore' : { data: stdin },
          stdout: { maxBytes: this.config.maxOutputBytes },
          stderr: { maxBytes: this.config.maxOutputBytes },
        },
        graceMs: this.config.processGraceMs,
        signal,
        env: { KINGSOFT_DOCS_TOKEN: undefined },
      })
    } catch {
      clearTimeout(timer)
      if (signal.aborted) throw new CliFailure(deadline.signal.aborted ? 'timeout' : 'cancelled')
      throw new CliFailure('failed')
    }

    try {
      const outcome = await handle.done
      if (signal.aborted) throw new CliFailure(deadline.signal.aborted ? 'timeout' : 'cancelled')
      const stdout = handle.collected.stdout?.readFrom(0)
      if (stdout === undefined) throw new CliFailure('failed')
      if (stdout.lossy) throw new CliFailure('too-large')
      return { outcome, stdout: stdout.text.trim() }
    } catch (error: unknown) {
      if (error instanceof CliFailure) throw error
      if (signal.aborted) throw new CliFailure(deadline.signal.aborted ? 'timeout' : 'cancelled')
      throw new CliFailure('failed')
    } finally {
      clearTimeout(timer)
    }
  }

  private connectFailure(error: unknown): Failure {
    if (!(error instanceof CliFailure)) return FAILURES.cliIncompatible
    if (error.kind === 'not-found') return FAILURES.cliNotFound
    if (error.kind === 'timeout') return FAILURES.loginTimeout
    if (error.kind === 'too-large') return FAILURES.cliIncompatible
    return FAILURES.loginFailed
  }

  private publishFailureUnlessDisposed(failure: Failure): void {
    if (!this.disposed) this.publish('failed', 0, failure)
  }

  private publish(
    status: KingsoftDocsConnectorStatus,
    toolCount: number,
    failure: { readonly errorCode: string | null; readonly errorMessage: string | null },
  ): void {
    const candidate: KingsoftDocsConnectorSnapshot = {
      status,
      toolCount,
      ...failure,
      updatedAt: new Date().toISOString(),
    }
    this.snapshotValue = candidate
    this.ctx.emit('kingsoft-docs-connector/change', this.current())
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-login lifecycle and authenticated Kingsoft Docs CLI execution. */
    kingsoftDocsConnector: KingsoftDocsConnectorGateway
  }
}

export default KingsoftDocsConnectorGateway
