import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import MeetingPresenceGateway, { type Config } from '../src/index.ts'

const CONFIG: Config = {
  botName: 'DeepSeek AI 会议助手',
  joinTimeoutMs: 120_000,
  statusPollMs: 500,
  processGraceMs: 5_000,
  headless: true,
}

class FakeHandle implements SubprocessHandle {
  readonly pid = 42
  readonly stdin = undefined
  readonly stdout = new PassThrough()
  readonly stderr = undefined
  readonly collected = {
    stderr: { readFrom: () => ({ text: this.stderrText, nextOffset: this.stderrText.length, lossy: false }) },
  }
  private readonly settlement = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.settlement.promise
  terminated = false
  waited = false
  stderrText = ''

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.stdout.end()
    this.settlement.resolve({ exitCode: null, signal: 'SIGTERM' })
  }

  async waitForExit(): Promise<boolean> {
    this.waited = true
    await this.done
    return true
  }

  line(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`)
  }

  exit(outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void {
    this.stdout.end()
    this.settlement.resolve(outcome)
  }
}

class FakeSubprocess extends SubprocessRuntime {
  specs: SubprocessSpawnSpec[] = []
  handles: FakeHandle[] = []

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const handle = new FakeHandle()
    this.handles.push(handle)
    return handle
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('not used')
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(): Promise<{
  ctx: Context
  gateway: MeetingPresenceGateway
  subprocess: FakeSubprocess
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(MeetingPresenceGateway, CONFIG)
  return {
    ctx,
    gateway: ctx.get('meetingPresence') as MeetingPresenceGateway,
    subprocess: ctx.subprocess as FakeSubprocess,
  }
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('MeetingPresenceGateway', () => {
  it('rejects unsupported and malformed links before spawning a browser', async () => {
    const { gateway, subprocess } = await harness()
    for (const url of [
      'not a url',
      'http://meet.google.com/abc-defg-hij',
      'https://example.com/abc-defg-hij',
      'https://meet.google.com/lookup/abc',
      'https://user@meet.google.com/abc-defg-hij',
      'http://zoom.us/j/12345678901',
      'https://zoom.example.com/j/12345678901',
      'https://zoom.us/wc/12345678901',
    ]) {
      await expect(gateway.join(url)).resolves.toMatchObject({
        ok: false,
        code: 'UNSUPPORTED_MEETING_URL',
      })
    }
    expect(subprocess.specs).toHaveLength(0)
  })

  it('publishes the worker admission lifecycle and refuses a second participant', async () => {
    const { ctx, gateway, subprocess } = await harness()
    const statuses: string[] = []
    ctx.on('meeting-presence/change', (snapshot) => { statuses.push(snapshot.status) })

    const joined = await gateway.join(' https://meet.google.com/abc-defg-hij/?authuser=2#fragment ')
    expect(joined).toMatchObject({ ok: true, snapshot: { status: 'starting' } })
    expect(subprocess.specs[0]?.argv).toEqual(expect.arrayContaining([
      '--import',
      expect.stringContaining('tsx'),
      expect.stringContaining('worker.ts'),
      'https://meet.google.com/abc-defg-hij',
      CONFIG.botName,
      String(CONFIG.joinTimeoutMs),
    ]))
    expect(subprocess.specs[0]).toMatchObject({
      stdio: { stdin: 'ignore', stdout: 'pipe' },
      graceMs: CONFIG.processGraceMs,
      env: {},
    })
    await expect(gateway.join('https://meet.google.com/xyz-abcd-efg')).resolves.toMatchObject({
      ok: false,
      code: 'MEETING_ALREADY_ACTIVE',
    })

    const handle = subprocess.handles[0]!
    handle.line({ type: 'state', status: 'waiting-admission' })
    await tick()
    expect(gateway.get()).toMatchObject({ status: 'waiting-admission', errorCode: null })
    handle.line({ type: 'state', status: 'joined' })
    await tick()
    expect(gateway.get()).toMatchObject({ status: 'joined', meetingUrl: 'https://meet.google.com/abc-defg-hij' })
    expect(statuses).toEqual(['starting', 'waiting-admission', 'joined'])
  })

  it('selects the Zoom worker and preserves only its embedded password', async () => {
    const { gateway, subprocess } = await harness()
    const joined = await gateway.join('https://us06web.zoom.us/j/12345678901?pwd=secret&utm_source=mail#invite')

    expect(joined).toMatchObject({
      ok: true,
      snapshot: {
        status: 'starting',
        provider: 'zoom',
        meetingUrl: 'https://us06web.zoom.us/j/12345678901?pwd=secret',
      },
    })
    expect(subprocess.specs[0]?.argv).toEqual(expect.arrayContaining([
      expect.stringContaining('zoom-worker.ts'),
      'https://us06web.zoom.us/j/12345678901?pwd=secret',
    ]))
  })

  it('terminates and joins the whole participant tree before leave settles', async () => {
    const { gateway, subprocess } = await harness()
    await gateway.join('https://meet.google.com/abc-defg-hij')
    const handle = subprocess.handles[0]!
    handle.line({ type: 'state', status: 'joined' })
    await tick()

    await expect(gateway.leave()).resolves.toMatchObject({ ok: true, snapshot: { status: 'left' } })
    expect(handle.terminated).toBe(true)
    expect(handle.waited).toBe(true)
    await expect(gateway.leave()).resolves.toMatchObject({ ok: false, code: 'NO_ACTIVE_MEETING' })
  })

  it('fails closed on malformed worker output and reports bounded stderr on an unexpected exit', async () => {
    const { gateway, subprocess } = await harness()
    await gateway.join('https://meet.google.com/abc-defg-hij')
    const malformed = subprocess.handles[0]!
    malformed.stdout.write('{bad json}\n')
    await tick()
    expect(gateway.get()).toMatchObject({ status: 'failed', errorCode: 'WORKER_PROTOCOL_ERROR' })
    expect(malformed.terminated).toBe(true)

    await gateway.join('https://meet.google.com/xyz-abcd-efg')
    const exited = subprocess.handles[1]!
    exited.stderrText = 'chrome unavailable'
    exited.exit({ exitCode: 2, signal: null })
    await tick()
    expect(gateway.get()).toMatchObject({
      status: 'failed',
      errorCode: 'BROWSER_EXITED',
      errorMessage: 'chrome unavailable',
    })
  })

  it('stops the active participant when the plugin is disposed', async () => {
    const { ctx, gateway, subprocess } = await harness()
    await gateway.join('https://meet.google.com/abc-defg-hij')
    const handle = subprocess.handles[0]!
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)
    expect(handle.terminated).toBe(true)
    expect(handle.waited).toBe(true)
  })

  it('materializes configured defaults before publishing wire state', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeSubprocess)
    await ctx.plugin(MeetingPresenceGateway, {})
    const gateway = ctx.get('meetingPresence') as MeetingPresenceGateway

    expect(gateway.get()).toMatchObject({
      status: 'idle',
      provider: null,
      botName: 'DeepSeek AI 会议助手',
      errorCode: null,
      errorMessage: null,
    })
  })
})
