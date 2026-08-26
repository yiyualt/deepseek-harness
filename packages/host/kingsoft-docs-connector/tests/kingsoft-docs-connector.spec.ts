import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessRuntime, {
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessSpawnSpec,
  type SubprocessTerminalHandle,
  type SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import KingsoftDocsConnectorGateway, {
  KINGSOFT_DOCS_TOOL_COUNT,
  type Config,
} from '../src/index.ts'

const contexts: Context[] = []
const SIGNAL = new AbortController().signal

interface Invocation {
  readonly argv: readonly string[]
  readonly stdin: string | undefined
  readonly env: NodeJS.ProcessEnv | undefined
}

interface ScriptedResult {
  readonly stdout: string
  readonly exitCode?: number
  readonly hang?: boolean
  readonly lossy?: boolean
}

class FakeSubprocess extends SubprocessRuntime {
  authenticated = false
  missing = false
  invalidStatus = false
  statusFailure = false
  statusLossy = false
  loginFailure = false
  loginLeavesUnauthenticated = false
  logoutFailure = false
  logoutLeavesAuthenticated = false
  logoutHang = false
  loginHang = false
  resolveHang = false
  resolveDelayMs = 0
  spawnFailure = false
  doneFailure = false
  doneRejectOnAbort = false
  noStdout = false
  helpFailure = false
  actionFailure = false
  actionLossy = false
  actionResult = '{"code":0,"data":{"files":[]}}'
  actionGate: PromiseWithResolvers<ScriptedResult> | undefined
  onSpawn: (() => void) | undefined
  readonly invocations: Invocation[] = []

  override resolveExecutable(_command: string, _env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted === true) return Promise.reject(new Error('cancelled'))
    if (this.missing) return Promise.reject(new Error('missing'))
    if (this.resolveHang) {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
      })
    }
    if (this.resolveDelayMs > 0) {
      return new Promise(resolve => setTimeout(() => { resolve('/fake/kdocs-cli') }, this.resolveDelayMs))
    }
    return Promise.resolve('/fake/kdocs-cli')
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const argv = spec.argv.slice(1)
    const stdin = typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : undefined
    this.invocations.push({ argv, stdin, env: spec.env })
    this.onSpawn?.()
    if (this.spawnFailure) throw new Error('spawn failed')
    const scripted = this.response(argv)
    let terminate = (): void => {}
    let source: Promise<ScriptedResult>
    if (this.doneFailure) {
      source = Promise.reject(new Error('process failed'))
    } else if (this.doneRejectOnAbort) {
      source = new Promise((_resolve, reject) => {
        if (spec.signal?.aborted === true) reject(new Error('cancelled'))
        else spec.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
      })
    } else {
      source = scripted instanceof Promise ? scripted : Promise.resolve(scripted)
    }
    const done = source
      .then((result) => {
        if (result.hang !== true) return result
        return new Promise<ScriptedResult>((resolve) => {
          const settle = (): void => { resolve({ stdout: '', exitCode: 143 }) }
          spec.signal?.addEventListener('abort', settle, { once: true })
          terminate = settle
        })
      })
      .then((result): SubprocessOutcome => ({ exitCode: result.exitCode ?? 0, signal: null }))
    const output = scripted instanceof Promise
      ? scripted.then(result => result.stdout)
      : Promise.resolve(scripted.stdout)
    const lossy = scripted instanceof Promise
      ? scripted.then(result => result.lossy === true)
      : Promise.resolve(scripted.lossy === true)
    let settledText = ''
    let settledLossy = false
    void output.then((value) => { settledText = value })
    void lossy.then((value) => { settledLossy = value })
    const collectedStdout = this.noStdout
      ? {}
      : { stdout: { readFrom: () => ({ text: settledText, nextOffset: Buffer.byteLength(settledText), lossy: settledLossy }) } }
    return {
      pid: 123,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        ...collectedStdout,
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => { terminate() },
      waitForExit: async () => { await done; return true },
    }
  }

  override spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('terminal execution is outside this fixture'))
  }

  private response(argv: readonly string[]): ScriptedResult | Promise<ScriptedResult> {
    if (argv[0] === 'auth' && argv[1] === 'status') {
      return {
        stdout: this.invalidStatus ? '{}' : JSON.stringify({ authenticated: this.authenticated, token: 'never-export' }),
        exitCode: this.statusFailure ? 1 : 0,
        lossy: this.statusLossy,
      }
    }
    if (argv[0] === 'auth' && argv[1] === 'login') {
      if (!this.loginFailure && !this.loginHang && !this.loginLeavesUnauthenticated) this.authenticated = true
      return { stdout: 'browser login secret', exitCode: this.loginFailure ? 1 : 0, hang: this.loginHang }
    }
    if (argv[0] === 'auth' && argv[1] === 'logout') {
      if (!this.logoutFailure && !this.logoutLeavesAuthenticated) this.authenticated = false
      return { stdout: '', exitCode: this.logoutFailure ? 1 : 0, hang: this.logoutHang }
    }
    if (argv.includes('--help')) return { stdout: 'OFFICIAL KDOCS HELP', exitCode: this.helpFailure ? 1 : 0 }
    if (this.actionGate !== undefined) return this.actionGate.promise
    return { stdout: this.actionResult, exitCode: this.actionFailure ? 1 : 0, lossy: this.actionLossy }
  }
}

const BASE_CONFIG: Config = {
  command: 'kdocs-cli',
  loginTimeoutMs: 100,
  commandTimeoutMs: 100,
  toolCallTimeoutMs: 100,
  processGraceMs: 5,
  maxInputBytes: 1_024,
  maxOutputBytes: 1_024,
}

function testConfig(overrides: Partial<Config> = {}): Config {
  return Object.assign({}, BASE_CONFIG, overrides)
}

async function boot(config: Partial<Config> = {}): Promise<{
  readonly ctx: Context
  readonly subprocess: FakeSubprocess
  readonly gateway: KingsoftDocsConnectorGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(KingsoftDocsConnectorGateway, testConfig(config))
  return {
    ctx,
    subprocess: ctx.subprocess as FakeSubprocess,
    gateway: ctx.kingsoftDocsConnector,
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('KingsoftDocsConnectorGateway', () => {
  it('opens browser login, verifies keychain state, and removes it on logout', async () => {
    const { ctx, subprocess, gateway } = await boot()
    const events: string[] = []
    ctx.on('kingsoft-docs-connector/change', (snapshot) => { events.push(snapshot.status) })

    await expect(gateway.connect()).resolves.toMatchObject({
      status: 'connected',
      toolCount: KINGSOFT_DOCS_TOOL_COUNT,
      errorCode: null,
    })
    expect(subprocess.invocations.map(call => call.argv)).toEqual([
      ['auth', 'status', '--compact'],
      ['auth', 'login', '--oauth-timeout', '95'],
      ['auth', 'status', '--compact'],
    ])
    expect(subprocess.invocations.every(call => call.env?.KINGSOFT_DOCS_TOKEN === undefined)).toBe(true)
    expect(JSON.stringify(await gateway.publicGet())).not.toContain('never-export')
    await expect(gateway.get()).resolves.toMatchObject({ status: 'connected' })
    expect(gateway.toolCallTimeoutMs).toBe(BASE_CONFIG.toolCallTimeoutMs)
    expect(events).toEqual(['connecting', 'connected'])

    await expect(gateway.disconnect()).resolves.toMatchObject({ status: 'disconnected', toolCount: 0 })
    expect(events).toEqual(['connecting', 'connected', 'disconnecting', 'disconnected'])
    expect(subprocess.authenticated).toBe(false)
  })

  it('reuses an authenticated keychain session without starting browser login', async () => {
    const { subprocess, gateway } = await boot()
    subprocess.authenticated = true

    await gateway.connect()

    expect(subprocess.invocations.map(call => call.argv)).toEqual([
      ['auth', 'status', '--compact'],
      ['auth', 'status', '--compact'],
    ])
  })

  it('reports stable install, login, timeout, response, and logout failures', async () => {
    const missing = await boot()
    missing.subprocess.missing = true
    await expect(missing.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CLI_NOT_FOUND' })

    const refused = await boot()
    refused.subprocess.loginFailure = true
    await expect(refused.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const timedOut = await boot({ loginTimeoutMs: 10, processGraceMs: 1 })
    timedOut.subprocess.loginHang = true
    await expect(timedOut.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_TIMEOUT' })

    const invalid = await boot()
    invalid.subprocess.invalidStatus = true
    await expect(invalid.gateway.connect()).resolves.toMatchObject({ status: 'failed', toolCount: 0 })

    const logout = await boot()
    logout.subprocess.authenticated = true
    await logout.gateway.connect()
    logout.subprocess.logoutFailure = true
    await expect(logout.gateway.disconnect()).resolves.toMatchObject({ status: 'failed', errorCode: 'DISCONNECT_FAILED' })
  })

  it('returns help and parsed JSON actions without shell interpolation', async () => {
    const { subprocess, gateway } = await boot()
    subprocess.authenticated = true
    await gateway.connect()

    await expect(gateway.runHelp(undefined, undefined, SIGNAL)).resolves.toBe('OFFICIAL KDOCS HELP')
    await expect(gateway.runHelp('drive', 'list-files', SIGNAL)).resolves.toBe('OFFICIAL KDOCS HELP')
    await expect(gateway.runHelp(undefined, 'list-files', SIGNAL)).rejects.toThrow(/requires a service/)
    await expect(gateway.runHelp('drive', 'bad action', SIGNAL)).rejects.toThrow(/kebab-case/)

    await expect(gateway.runAction({
      service: 'drive',
      action: 'list-files',
      params: { parent_id: 'root; touch /tmp/never' },
      signal: SIGNAL,
    })).resolves.toEqual({ code: 0, data: { files: [] } })
    const call = subprocess.invocations.at(-1)!
    expect(call.argv).toEqual(['drive', 'list-files', '-', '--output', 'json', '--timeout', '95'])
    expect(call.stdin).toBe('{"parent_id":"root; touch /tmp/never"}')
  })

  it('fails closed for invalid, oversized, rejected, and unauthenticated actions', async () => {
    const { subprocess, gateway } = await boot({ maxInputBytes: 20 })
    subprocess.authenticated = true
    await gateway.connect()

    await expect(gateway.runAction({ service: 'drive', action: 'bad action', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/kebab-case/)
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: { value: 'x'.repeat(50) }, signal: SIGNAL }))
      .rejects.toThrow(/byte limit/)

    subprocess.actionResult = '{not-json'
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/invalid JSON/)
    subprocess.actionResult = '{"code":500123,"message":"secret detail"}'
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow('code 500123')
    subprocess.actionResult = '{"code":400006,"token":"never-export"}'
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/login expired/)
    expect(gateway.current()).toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED', toolCount: 0 })
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/not connected/)
  })

  it('normalizes incompatible status and process-output failures', async () => {
    const status = await boot()
    status.subprocess.statusFailure = true
    await expect(status.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const unauthenticated = await boot()
    unauthenticated.subprocess.loginLeavesUnauthenticated = true
    await expect(unauthenticated.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const spawn = await boot()
    spawn.subprocess.spawnFailure = true
    await expect(spawn.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const done = await boot()
    done.subprocess.doneFailure = true
    await expect(done.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const missingOutput = await boot()
    missingOutput.subprocess.noStdout = true
    await expect(missingOutput.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_FAILED' })

    const oversizedOutput = await boot()
    oversizedOutput.subprocess.actionLossy = true
    oversizedOutput.subprocess.authenticated = true
    await oversizedOutput.gateway.connect()
    await expect(oversizedOutput.gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/too-large/)

    const oversizedStatus = await boot()
    oversizedStatus.subprocess.statusLossy = true
    await expect(oversizedStatus.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CLI_INCOMPATIBLE' })
  })

  it('rejects failed help and action processes plus non-object result codes', async () => {
    const { subprocess, gateway } = await boot()
    subprocess.authenticated = true
    await gateway.connect()

    subprocess.helpFailure = true
    await expect(gateway.runHelp('drive', undefined, SIGNAL)).rejects.toThrow(/could not render help/)
    subprocess.helpFailure = false
    subprocess.actionFailure = true
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .rejects.toThrow(/command failed/)
    subprocess.actionFailure = false
    subprocess.actionResult = '[]'
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .resolves.toEqual([])
    subprocess.actionResult = '{"code":false}'
    await expect(gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL }))
      .resolves.toEqual({ code: false })
  })

  it('cancels caller work and bounds executable resolution', async () => {
    const caller = await boot()
    caller.subprocess.authenticated = true
    await caller.gateway.connect()
    caller.subprocess.actionGate = Promise.withResolvers<ScriptedResult>()
    caller.subprocess.actionGate.resolve({ stdout: '', hang: true })
    const cancellation = new AbortController()
    const action = caller.gateway.runAction({
      service: 'drive',
      action: 'list-files',
      params: {},
      signal: cancellation.signal,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    cancellation.abort()
    await expect(action).rejects.toThrow(/cancelled/)

    const deadline = await boot({ commandTimeoutMs: 10, processGraceMs: 1 })
    deadline.subprocess.resolveHang = true
    await expect(deadline.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_TIMEOUT' })

    const resolveCancellation = await boot()
    resolveCancellation.subprocess.authenticated = true
    await resolveCancellation.gateway.connect()
    resolveCancellation.subprocess.resolveHang = true
    const resolveController = new AbortController()
    const help = resolveCancellation.gateway.runHelp('drive', undefined, resolveController.signal)
    resolveController.abort()
    await expect(help).rejects.toThrow(/cancelled/)
  })

  it('normalizes spawn and process rejection after timeout or caller cancellation', async () => {
    const spawnCancelled = await boot()
    spawnCancelled.subprocess.authenticated = true
    await spawnCancelled.gateway.connect()
    const spawnController = new AbortController()
    spawnCancelled.subprocess.onSpawn = () => { spawnController.abort() }
    spawnCancelled.subprocess.spawnFailure = true
    await expect(spawnCancelled.gateway.runHelp('drive', undefined, spawnController.signal)).rejects.toThrow(/cancelled/)

    const spawnTimedOut = await boot({ commandTimeoutMs: 5, processGraceMs: 1 })
    spawnTimedOut.subprocess.resolveDelayMs = 10
    spawnTimedOut.subprocess.spawnFailure = true
    await expect(spawnTimedOut.gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'LOGIN_TIMEOUT' })

    const doneCancelled = await boot()
    doneCancelled.subprocess.authenticated = true
    await doneCancelled.gateway.connect()
    const doneController = new AbortController()
    doneCancelled.subprocess.onSpawn = () => { doneController.abort() }
    doneCancelled.subprocess.doneRejectOnAbort = true
    await expect(doneCancelled.gateway.runHelp('drive', undefined, doneController.signal)).rejects.toThrow(/cancelled/)

    const doneTimedOut = await boot({ commandTimeoutMs: 5, processGraceMs: 1 })
    doneTimedOut.subprocess.authenticated = true
    await doneTimedOut.gateway.connect()
    doneTimedOut.subprocess.doneRejectOnAbort = true
    await expect(doneTimedOut.gateway.runHelp('drive', undefined, SIGNAL)).rejects.toThrow(/timeout/)
  })

  it('reports logout verification failure and makes disposed lifecycle calls inert', async () => {
    const logout = await boot()
    logout.subprocess.authenticated = true
    await logout.gateway.connect()
    logout.subprocess.logoutLeavesAuthenticated = true
    await expect(logout.gateway.disconnect()).resolves.toMatchObject({ status: 'failed', errorCode: 'DISCONNECT_FAILED' })

    const disposed = await boot()
    await disposed.ctx.fiber.dispose()
    await expect(disposed.gateway.connect()).resolves.toMatchObject({ status: 'disconnected' })
    await expect(disposed.gateway.disconnect()).resolves.toMatchObject({ status: 'disconnected' })
    await expect(disposed.gateway.runHelp(undefined, undefined, SIGNAL)).rejects.toThrow(/not connected/)
  })

  it('keeps lifecycle serialization usable after an event listener throws', async () => {
    const { ctx, subprocess, gateway } = await boot()
    const dispose = ctx.on('kingsoft-docs-connector/change', () => { throw new Error('listener failed') })
    await expect(gateway.connect()).rejects.toThrow('listener failed')
    dispose()
    subprocess.authenticated = true
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected' })
  })

  it('maps an unexpected connected-state observer failure to an incompatible CLI result', async () => {
    const { ctx, subprocess, gateway } = await boot()
    const dispose = ctx.on('kingsoft-docs-connector/change', (snapshot) => {
      if (snapshot.status === 'connected') throw new Error('observer failed')
    })
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'failed', errorCode: 'CLI_INCOMPATIBLE' })
    dispose()
    subprocess.authenticated = true
    await expect(gateway.connect()).resolves.toMatchObject({ status: 'connected' })
  })

  it('does not publish failure after teardown cancels login or logout', async () => {
    const connecting = await boot()
    connecting.subprocess.loginHang = true
    const connect = connecting.gateway.connect()
    await new Promise(resolve => setTimeout(resolve, 0))
    await connecting.ctx.fiber.dispose()
    await expect(connect).resolves.toMatchObject({ status: 'connecting' })

    const disconnecting = await boot()
    disconnecting.subprocess.authenticated = true
    await disconnecting.gateway.connect()
    disconnecting.subprocess.logoutHang = true
    const disconnect = disconnecting.gateway.disconnect()
    await new Promise(resolve => setTimeout(resolve, 0))
    await disconnecting.ctx.fiber.dispose()
    await expect(disconnect).resolves.toMatchObject({ status: 'disconnecting' })
  })

  it('publishes only the first of two simultaneous authentication rejections', async () => {
    const { subprocess, gateway } = await boot()
    subprocess.authenticated = true
    await gateway.connect()
    subprocess.actionGate = Promise.withResolvers<ScriptedResult>()
    const first = gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL })
    const second = gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL })
    await new Promise(resolve => setTimeout(resolve, 0))
    subprocess.actionGate.resolve({ stdout: '{"code":400006}' })
    await expect(first).rejects.toThrow(/login expired/)
    await expect(second).rejects.toThrow(/login expired/)
    expect(gateway.current()).toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
  })

  it('removes tools before waiting for an already-running action', async () => {
    const { ctx, subprocess, gateway } = await boot()
    subprocess.authenticated = true
    await gateway.connect()
    subprocess.actionGate = Promise.withResolvers<ScriptedResult>()
    const action = gateway.runAction({ service: 'drive', action: 'list-files', params: {}, signal: SIGNAL })
    await Promise.resolve()
    const disconnect = gateway.disconnect()
    await Promise.resolve()
    expect(gateway.current().status).toBe('disconnecting')
    subprocess.actionGate.resolve({ stdout: '{"code":0,"data":{}}' })
    await expect(action).resolves.toEqual({ code: 0, data: {} })
    await expect(disconnect).resolves.toMatchObject({ status: 'disconnected' })
    expect(ctx.kingsoftDocsConnector.current().status).toBe('disconnected')
  })

  it('rejects invalid direct configuration before spawning a process', () => {
    const command = new Context()
    const integer = new Context()
    const grace = new Context()
    contexts.push(command, integer, grace)
    expect(() => new KingsoftDocsConnectorGateway(command, testConfig({ command: ' ' })))
      .toThrow(/command must be nonempty/)
    expect(() => new KingsoftDocsConnectorGateway(integer, testConfig({ maxInputBytes: 1.5 })))
      .toThrow(/positive integer/)
    expect(() => new KingsoftDocsConnectorGateway(grace, testConfig({ processGraceMs: 100 })))
      .toThrow(/must exceed processGraceMs/)
  })
})
