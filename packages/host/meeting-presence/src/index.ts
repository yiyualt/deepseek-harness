/** Presence-only Google Meet or Zoom participant exposed through the Web Remote API. */

import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { parseMeetingWorkerMessage } from './protocol.ts'
import type {
  MeetingPresenceMutation,
  MeetingProvider,
  MeetingPresenceSnapshot,
  MeetingPresenceStatus,
} from './types.ts'

export type * from './types.ts'

/** Runtime choices shared by the packaged meeting participant drivers. */
export interface Config {
  /** Participant name visible to meeting attendees. */
  botName: string
  /** Maximum time to wait for a host to admit the participant. */
  joinTimeoutMs: number
  /** Interval used by the browser worker to detect admission and removal. */
  statusPollMs: number
  /** Grace before subprocess termination escalates to a force kill. */
  processGraceMs: number
  /** Launch Chrome without a visible window. */
  headless: boolean
  /** Explicit Chrome executable; absent selects Playwright's installed Chrome channel. */
  chromeExecutablePath?: string
}

export const Config: Schema<Config> = Schema.object({
  botName: Schema.string().default('DeepSeek AI 会议助手'),
  joinTimeoutMs: Schema.number().min(10_000).max(600_000).default(120_000),
  statusPollMs: Schema.number().min(100).max(5_000).default(500),
  processGraceMs: Schema.number().min(100).max(30_000).default(5_000),
  headless: Schema.boolean().default(false),
  chromeExecutablePath: Schema.string(),
})

type ActiveParticipant = {
  handle: SubprocessHandle
  generation: number
  requestedLeave: boolean
}

const ACTIVE_STATUSES = new Set<MeetingPresenceStatus>([
  'starting', 'waiting-admission', 'joined', 'leaving',
])
const DIAGNOSTIC_MAX = 1000

type MeetingTarget = { provider: MeetingProvider; url: string }

function canonicalMeetingTarget(raw: string): MeetingTarget | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return undefined
  if (url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) {
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/$/, '')
    return { provider: 'google-meet', url: url.toString() }
  }
  if ((url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us'))
    && /^\/(?:j|wc\/join)\/\d{9,12}\/?$/.test(url.pathname)) {
    const password = url.searchParams.get('pwd')
    url.hash = ''
    url.search = ''
    if (password !== null) url.searchParams.set('pwd', password)
    url.pathname = url.pathname.replace(/\/$/, '')
    return { provider: 'zoom', url: url.toString() }
  }
  return undefined
}

function boundedDiagnostic(value: string): string {
  return value.trim().slice(0, DIAGNOSTIC_MAX)
}

/** Remote service that owns at most one browser participant process. */
export class MeetingPresenceGateway extends TypertRemoteService {
  static inject = ['subprocess']
  static Config: Schema<Config> = Config

  private snapshot: MeetingPresenceSnapshot
  private active: ActiveParticipant | undefined
  private generation = 0
  private disposed = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'meetingPresence')
    this.snapshot = this.makeSnapshot('idle', null, null, null, null)
    ctx.effect(() => async () => { await this.disposeParticipant() }, 'meeting-presence: participant teardown')
  }

  /** @returns the complete current participant state. */
  @Remote('get')
  get(): MeetingPresenceSnapshot {
    return { ...this.snapshot }
  }

  /**
   * Start one anonymous, presence-only Google Meet or Zoom participant.
   * @param rawUrl - user-supplied meeting URL.
   * @returns accepted state, or a refusal that leaves the current participant unchanged.
   */
  @Remote('join')
  async join(rawUrl: string): Promise<MeetingPresenceMutation> {
    const target = canonicalMeetingTarget(rawUrl)
    if (target === undefined) {
      return this.refuse('UNSUPPORTED_MEETING_URL', '请输入完整的 Google Meet 或 Zoom 会议链接。')
    }
    if (this.disposed) return this.refuse('SERVICE_STOPPING', '会议服务正在关闭。')
    if (ACTIVE_STATUSES.has(this.snapshot.status)) {
      return this.refuse('MEETING_ALREADY_ACTIVE', '已有会议助手正在运行，请先让它离开。')
    }

    const generation = ++this.generation
    this.publish(this.makeSnapshot('starting', target.url, target.provider, null, null))
    try {
      const node = await this.ctx.subprocess.resolveExecutable(process.execPath)
      if (this.requestStale(generation)) {
        return this.refuse('SERVICE_STOPPING', '会议服务正在关闭。')
      }
      const workerName = target.provider === 'zoom' ? 'zoom-worker' : 'worker'
      const workerArgv = import.meta.url.endsWith('.ts')
        ? [
          '--import',
          import.meta.resolve('tsx/esm'),
          fileURLToPath(new URL(`./${workerName}.ts`, import.meta.url)),
        ]
        : [fileURLToPath(new URL(`./${workerName}.js`, import.meta.url))]
      const handle = this.ctx.subprocess.spawn({
        argv: [
          node,
          ...workerArgv,
          target.url,
          this.config.botName,
          String(this.config.joinTimeoutMs),
          String(this.config.statusPollMs),
          this.config.headless ? 'true' : 'false',
          this.config.chromeExecutablePath ?? '',
        ],
        cwd: process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: { maxBytes: DIAGNOSTIC_MAX },
        },
        graceMs: this.config.processGraceMs,
        env: {},
      })
      const active: ActiveParticipant = { handle, generation, requestedLeave: false }
      this.active = active
      this.observe(active)
      return { ok: true, snapshot: this.get() }
    } catch (error: unknown) {
      if (generation === this.generation) {
        this.publish(this.makeSnapshot(
          'failed', target.url, target.provider, 'BROWSER_START_FAILED', boundedDiagnostic(String(error)),
        ))
      }
      return this.refuse('BROWSER_START_FAILED', '无法启动会议助手。')
    }
  }

  /**
   * Stop the active participant and wait for its complete browser process tree.
   * @returns the settled participant state.
   */
  @Remote('leave')
  async leave(): Promise<MeetingPresenceMutation> {
    const active = this.active
    if (active === undefined) return this.refuse('NO_ACTIVE_MEETING', '当前没有正在运行的会议助手。')
    active.requestedLeave = true
    this.publish({ ...this.snapshot, status: 'leaving', updatedAt: new Date().toISOString() })
    active.handle.terminate()
    try {
      await active.handle.done
      await active.handle.waitForExit()
    } catch (error: unknown) {
      if (this.active === active) {
        this.active = undefined
        this.publish(this.makeSnapshot(
          'failed', this.snapshot.meetingUrl, this.snapshot.provider, 'BROWSER_STOP_FAILED', boundedDiagnostic(String(error)),
        ))
      }
      return this.refuse('BROWSER_STOP_FAILED', '会议助手未能正常离开。')
    }
    if (this.active === active) {
      this.active = undefined
      this.publish(this.makeSnapshot('left', this.snapshot.meetingUrl, this.snapshot.provider, null, null))
    }
    return { ok: true, snapshot: this.get() }
  }

  private observe(active: ActiveParticipant): void {
    const stdout = active.handle.stdout
    if (stdout === undefined) {
      this.failProtocol(active, '会议助手没有提供状态输出。')
      return
    }
    const lines = createInterface({ input: stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (this.active !== active || this.disposed) return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        this.failProtocol(active, '会议助手返回了无效状态。')
        return
      }
      const message = parseMeetingWorkerMessage(parsed)
      if (message === undefined) {
        this.failProtocol(active, '会议助手返回了未知状态。')
        return
      }
      if (message.type === 'error') {
        this.publish(this.makeSnapshot(
          'failed', this.snapshot.meetingUrl, this.snapshot.provider, message.code, boundedDiagnostic(message.message),
        ))
        active.handle.terminate()
        return
      }
      if (message.status === 'left') {
        this.publish(this.makeSnapshot('left', this.snapshot.meetingUrl, this.snapshot.provider, null, null))
        active.handle.terminate()
        return
      }
      this.publish(this.makeSnapshot(message.status, this.snapshot.meetingUrl, this.snapshot.provider, null, null))
    })
    active.handle.done.then(
      (outcome) => { this.settle(active, outcome.exitCode, outcome.signal) },
      (error: unknown) => { this.settleSpawnFailure(active, error) },
    ).finally(() => { lines.close() })
  }

  private settle(active: ActiveParticipant, exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.active !== active) return
    this.active = undefined
    if (this.disposed) return
    if (active.requestedLeave || this.snapshot.status === 'left') {
      this.publish(this.makeSnapshot('left', this.snapshot.meetingUrl, this.snapshot.provider, null, null))
      return
    }
    if (this.snapshot.status === 'failed') return
    const stderr = active.handle.collected.stderr?.readFrom(0).text ?? ''
    this.publish(this.makeSnapshot(
      'failed',
      this.snapshot.meetingUrl,
      this.snapshot.provider,
      'BROWSER_EXITED',
      boundedDiagnostic(stderr) || `会议助手意外退出（exit=${String(exitCode)}, signal=${String(signal)}）。`,
    ))
  }

  private settleSpawnFailure(active: ActiveParticipant, error: unknown): void {
    if (this.active !== active) return
    this.active = undefined
    if (this.disposed) return
    this.publish(this.makeSnapshot(
      'failed', this.snapshot.meetingUrl, this.snapshot.provider, 'BROWSER_START_FAILED', boundedDiagnostic(String(error)),
    ))
  }

  private failProtocol(active: ActiveParticipant, message: string): void {
    if (this.active !== active) return
    this.publish(this.makeSnapshot('failed', this.snapshot.meetingUrl, this.snapshot.provider, 'WORKER_PROTOCOL_ERROR', message))
    active.handle.terminate()
  }

  private requestStale(generation: number): boolean {
    return this.disposed || generation !== this.generation
  }

  private async disposeParticipant(): Promise<void> {
    this.disposed = true
    const active = this.active
    this.active = undefined
    this.generation += 1
    if (active === undefined) return
    active.requestedLeave = true
    active.handle.terminate()
    await active.handle.done.catch(() => {})
    await active.handle.waitForExit()
  }

  private makeSnapshot(
    status: MeetingPresenceStatus,
    meetingUrl: string | null,
    provider: MeetingProvider | null,
    errorCode: string | null,
    errorMessage: string | null,
  ): MeetingPresenceSnapshot {
    return {
      status,
      meetingUrl,
      provider,
      botName: this.config.botName,
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    }
  }

  private publish(snapshot: MeetingPresenceSnapshot): void {
    this.snapshot = snapshot
    if (!this.disposed) this.ctx.emit('meeting-presence/change', { ...snapshot })
  }

  private refuse(code: string, message: string): MeetingPresenceMutation {
    return { ok: false, code, message, snapshot: this.get() }
  }
}

export default MeetingPresenceGateway
