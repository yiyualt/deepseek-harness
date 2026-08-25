/** Shared Host lifecycle for explicit user-managed MCP connections. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  McpRuntimeSnapshot,
  McpServerSnapshot,
} from '@deepseek-ai/dsh-mcp'
import type {
  McpConnectorDefinition,
  McpConnectorEventSnapshot,
  McpConnectorFailure,
  McpConnectorSnapshot,
  McpConnectorStatus,
} from './types.ts'

export type * from './types.ts'

type CredentialState = Pick<
  McpConnectorSnapshot,
  'credentialConfigured' | 'credentialSource' | 'credentialWritable'
>

const NO_FAILURE: McpConnectorFailure = { errorCode: null, errorMessage: null }

class ConnectorAuthenticationRejected extends Error {
  constructor() {
    super('AUTH_REJECTED')
    this.name = 'ConnectorAuthenticationRejected'
  }
}

function isAuthRejection(value: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = value
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break
    seen.add(current)
    if (typeof current === 'string' || typeof current === 'number') {
      const text = String(current).toUpperCase()
      return text.includes('401')
        || text.includes('403')
        || text.includes('UNAUTHORIZED')
        || text.includes('AUTH_REJECTED')
        || text.includes('INVALID_TOKEN')
    }
    if (typeof current !== 'object') break
    const record = current as Record<string, unknown>
    for (const key of ['code', 'status', 'statusCode', 'name', 'message']) {
      const part = record[key]
      if ((typeof part === 'string' || typeof part === 'number') && isAuthRejection(part)) return true
    }
    current = record.cause
  }
  return false
}

function isCredentialMissing(value: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = value
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'string') return current.toUpperCase().includes('CREDENTIAL_MISSING')
    if (typeof current !== 'object' || seen.has(current)) return false
    seen.add(current)
    const record = current as Record<string, unknown>
    if (typeof record.code === 'string' && record.code.toUpperCase().includes('CREDENTIAL_MISSING')) return true
    current = record.cause
  }
  return false
}

/**
 * Owns one connector's serialized credential and MCP lifecycle without exposing
 * a Remote namespace. A vendor gateway delegates its decorated methods here.
 */
export class McpConnectorLifecycle {
  private snapshot: McpConnectorSnapshot = {
    status: 'disconnected',
    credentialConfigured: false,
    credentialSource: null,
    credentialWritable: false,
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  }

  private connectionRequested = false
  private disposed = false
  private operations: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context carrying credential and MCP services.
   * @param definition - fixed provider endpoint, identity, authorization, and failures.
   * @param emitPublic - publishes value-free state through the vendor-owned event.
   */
  constructor(
    private readonly ctx: Context,
    private readonly definition: McpConnectorDefinition,
    private readonly emitPublic: (snapshot: McpConnectorEventSnapshot) => void,
  ) {
    ctx.effect(() => async () => {
      this.disposed = true
      this.connectionRequested = false
      await this.operations
      if (this.serverFrom(this.ctx.mcp.snapshot()) !== undefined) {
        await this.ctx.mcp.disconnect(this.definition.serverName)
      }
    }, `${definition.effectName}: MCP teardown`)

    ctx.on('credentials/updated', (ref) => {
      if (ref !== definition.credentialRef) return
      void this.enqueue(async () => { await this.handleCredentialUpdate() })
    })
    ctx.on('mcp/change', (snapshot) => {
      this.reconcileMcp(snapshot)
    })

    ctx.effect(async () => {
      await this.enqueue(async () => { await this.refreshCredentialState(false) })
      return () => {}
    }, `${definition.effectName}: initial credential description`)
  }

  /**
   * Refresh safe credential metadata and read the complete connector state.
   * @returns the complete current connector state after the refresh.
   */
  async get(): Promise<McpConnectorSnapshot> {
    return this.enqueue(async () => {
      if (await this.refreshCredentialState(false) && !this.disposed) {
        this.reconcileMcp(this.ctx.mcp.snapshot())
      }
      return this.copySnapshot()
    })
  }

  /**
   * Read the fields approved for trusted non-loopback Web clients without
   * consulting the credential provider.
   * @returns a detached value-free connector snapshot.
   */
  publicGet(): McpConnectorEventSnapshot {
    return this.eventSnapshot()
  }

  /**
   * Connect the fixed endpoint through the configured credential reference.
   * @returns the complete state after initialization and optional verification settle.
   */
  async connect(): Promise<McpConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.copySnapshot()
      this.connectionRequested = true
      const credential = await this.readCredentialState()
      if (this.disposed) return this.copySnapshot()
      if (credential === undefined) return this.copySnapshot()
      if (!credential.credentialConfigured) {
        if (!await this.disconnectExistingServer()) return this.copySnapshot()
        this.publishStatus('failed', 0, this.definition.failures.credentialMissing)
        return this.copySnapshot()
      }

      this.publishStatus('connecting', 0, NO_FAILURE)
      if (!await this.disconnectExistingServer()) return this.copySnapshot()
      let established = false
      try {
        const server = await this.ctx.mcp.connect({
          serverName: this.definition.serverName,
          transport: {
            kind: 'streamable-http',
            url: this.definition.endpoint,
            authorization: {
              kind: 'credential',
              ref: this.definition.credentialRef,
              scheme: this.definition.authorizationScheme,
            },
          },
        })
        established = server.status === 'connected'
        if (established) await this.runConnectionCheck()
        if (!this.disposed) this.publishServer(server)
      } catch (error: unknown) {
        if (established && !await this.disconnectAfterRejectedCheck()) return this.copySnapshot()
        if (!this.disposed) {
          const failed = this.serverFrom(this.ctx.mcp.snapshot())
          if (failed?.status === 'failed'
            && (failed.errorCode !== undefined || failed.errorMessage !== undefined)) this.publishServer(failed)
          else this.publishStatus('failed', 0, this.safeFailure(error))
        }
      }
      return this.copySnapshot()
    })
  }

  /**
   * Disconnect and wait for the active MCP transport generation to quiesce.
   * @returns the complete state after disconnection settles.
   */
  async disconnect(): Promise<McpConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.copySnapshot()
      this.connectionRequested = false
      const server = this.serverFrom(this.ctx.mcp.snapshot())
      if (server === undefined) {
        this.publishStatus('disconnected', 0, NO_FAILURE)
        return this.copySnapshot()
      }
      this.publishStatus('disconnecting', 0, NO_FAILURE)
      try {
        await this.ctx.mcp.disconnect(this.definition.serverName)
        if (!this.disposed) this.publishStatus('disconnected', 0, NO_FAILURE)
      } catch {
        if (!this.disposed) this.publishStatus('failed', 0, this.definition.failures.disconnectFailed)
      }
      return this.copySnapshot()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(() => {}, () => {})
    return result
  }

  private async readCredentialState(): Promise<CredentialState | undefined> {
    try {
      const info = await this.ctx.credentials.describe(this.definition.credentialRef)
      const configured = await this.ctx.credentials.resolve(this.definition.credentialRef) !== undefined
      const state: CredentialState = {
        credentialConfigured: configured,
        credentialSource: configured ? info.source ?? null : null,
        credentialWritable: info.writable,
      }
      this.publishCredentialState(state)
      return state
    } catch {
      this.publishStatus('failed', 0, this.definition.failures.credentialLookup)
      return undefined
    }
  }

  private async refreshCredentialState(resolveValue: boolean): Promise<boolean> {
    try {
      const info = await this.ctx.credentials.describe(this.definition.credentialRef)
      const configured = resolveValue
        ? await this.ctx.credentials.resolve(this.definition.credentialRef) !== undefined
        : info.configured
      this.publishCredentialState({
        credentialConfigured: configured,
        credentialSource: configured ? info.source ?? null : null,
        credentialWritable: info.writable,
      })
      return true
    } catch {
      this.publishStatus('failed', 0, this.definition.failures.credentialLookup)
      return false
    }
  }

  private async handleCredentialUpdate(): Promise<void> {
    if (!await this.refreshCredentialState(true) || this.disposed) return
    if (!this.snapshot.credentialConfigured && this.connectionRequested) {
      if (await this.disconnectExistingServer() && !this.disposed) {
        this.publishStatus('failed', 0, this.definition.failures.credentialMissing)
      }
      return
    }
    const runtime = this.ctx.mcp.snapshot()
    if (this.connectionRequested && this.serverFrom(runtime) === undefined) return
    this.reconcileMcp(runtime)
  }

  private async runConnectionCheck(): Promise<void> {
    const check = this.definition.connectionCheck
    if (check === undefined) return
    const result = await this.ctx.mcp.callTool({
      serverName: this.definition.serverName,
      name: check.toolName,
      args: check.args,
      signal: new AbortController().signal,
      timeoutMs: check.timeoutMs,
    })
    switch (check.classify(result)) {
      case 'accepted':
        return
      case 'auth-rejected':
        throw new ConnectorAuthenticationRejected()
      case 'failed':
        throw new Error('MCP connector verification failed')
    }
  }

  private async disconnectAfterRejectedCheck(): Promise<boolean> {
    try {
      await this.ctx.mcp.disconnect(this.definition.serverName)
      return true
    } catch {
      if (!this.disposed) this.publishStatus('failed', 0, this.definition.failures.disconnectFailed)
      return false
    }
  }

  private async disconnectExistingServer(): Promise<boolean> {
    if (this.serverFrom(this.ctx.mcp.snapshot()) === undefined) return true
    try {
      await this.ctx.mcp.disconnect(this.definition.serverName)
      return true
    } catch {
      this.publishStatus('failed', 0, this.definition.failures.disconnectFailed)
      return false
    }
  }

  private reconcileMcp(runtime: McpRuntimeSnapshot): void {
    if (this.connectionRequested && !this.snapshot.credentialConfigured) {
      this.publishStatus('failed', 0, this.definition.failures.credentialMissing)
      return
    }
    const server = this.serverFrom(runtime)
    if (server !== undefined) {
      if (!this.connectionRequested && this.snapshot.status !== 'disconnecting') return
      if (this.snapshot.status === 'connecting' && server.status === 'disconnecting') return
      this.publishServer(server)
      return
    }
    if (this.snapshot.status === 'connecting' || this.snapshot.status === 'disconnecting') return
    if (this.connectionRequested) {
      this.publishStatus('failed', 0, this.definition.failures.connectionLost)
    } else {
      this.publishStatus('disconnected', 0, NO_FAILURE)
    }
  }

  private publishServer(server: McpServerSnapshot): void {
    switch (server.status) {
      case 'connecting':
      case 'reconnecting':
      case 'disconnecting':
        this.publishStatus(server.status, server.tools.length, NO_FAILURE)
        return
      case 'connected':
        this.publishStatus('connected', server.tools.length, NO_FAILURE)
        return
      case 'failed':
        this.publishStatus('failed', 0, this.safeFailure({
          code: server.errorCode,
          message: server.errorMessage,
        }))
        return
    }
  }

  private publishCredentialState(credential: CredentialState): void {
    this.publish({ ...this.snapshot, ...credential })
  }

  private publishStatus(status: McpConnectorStatus, toolCount: number, failure: McpConnectorFailure): void {
    this.publish({ ...this.snapshot, status, toolCount, ...failure })
  }

  private publish(next: Omit<McpConnectorSnapshot, 'updatedAt'>): void {
    const candidate = { ...next, updatedAt: new Date().toISOString() }
    if (this.sameState(candidate, this.snapshot)) return
    const publicChanged = !this.samePublicState(candidate, this.snapshot)
    this.snapshot = candidate
    if (!this.disposed && publicChanged) this.emitPublic(this.eventSnapshot())
  }

  private sameState(left: McpConnectorSnapshot, right: McpConnectorSnapshot): boolean {
    return this.samePublicState(left, right)
      && left.credentialConfigured === right.credentialConfigured
      && left.credentialSource === right.credentialSource
      && left.credentialWritable === right.credentialWritable
  }

  private samePublicState(left: McpConnectorSnapshot, right: McpConnectorSnapshot): boolean {
    return left.status === right.status
      && left.toolCount === right.toolCount
      && left.errorCode === right.errorCode
      && left.errorMessage === right.errorMessage
  }

  private copySnapshot(): McpConnectorSnapshot {
    return { ...this.snapshot }
  }

  private eventSnapshot(): McpConnectorEventSnapshot {
    const { status, toolCount, errorCode, errorMessage, updatedAt } = this.snapshot
    return { status, toolCount, errorCode, errorMessage, updatedAt }
  }

  private serverFrom(snapshot: McpRuntimeSnapshot): McpServerSnapshot | undefined {
    return snapshot.servers.find(server => server.serverName === this.definition.serverName)
  }

  private safeFailure(value: unknown): McpConnectorFailure {
    if (isCredentialMissing(value)) return this.definition.failures.credentialMissing
    if (isAuthRejection(value)) return this.definition.failures.authRejected
    return this.definition.failures.connectionFailed
  }
}
