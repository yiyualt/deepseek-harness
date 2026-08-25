/** Tencent Docs MCP connection lifecycle exposed through the Web Remote API. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  mcpServerName,
  type McpRuntimeSnapshot,
  type McpServerSnapshot,
} from '@deepseek-ai/dsh-mcp'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TencentDocsConnectorEventSnapshot,
  TencentDocsConnectorSnapshot,
  TencentDocsConnectorStatus,
} from './types.ts'

export type * from './types.ts'

/** Fixed Tencent Docs Streamable HTTP MCP endpoint. */
export const TENCENT_DOCS_MCP_ENDPOINT = 'https://docs.qq.com/openapi/mcp'

/** Credential reference used for the Tencent Docs space MCP Token. */
export const TENCENT_DOCS_MCP_CREDENTIAL_REF = credentialRef('TENCENT_DOCS_MCP_TOKEN')

/** Process-wide MCP server name reserved by this connector. */
export const TENCENT_DOCS_MCP_SERVER_NAME = mcpServerName('tencent_docs')

type CredentialState = Pick<
  TencentDocsConnectorSnapshot,
  'credentialConfigured' | 'credentialSource' | 'credentialWritable'
>

type Failure = Pick<TencentDocsConnectorSnapshot, 'errorCode' | 'errorMessage'>

const FAILURE = {
  credentialMissing: {
    errorCode: 'CREDENTIAL_MISSING',
    errorMessage: 'Save a Tencent Docs space MCP Token before connecting.',
  },
  credentialLookup: {
    errorCode: 'CREDENTIAL_LOOKUP_FAILED',
    errorMessage: 'Unable to read the Tencent Docs Token configuration.',
  },
  authRejected: {
    errorCode: 'AUTH_REJECTED',
    errorMessage: 'Tencent Docs rejected the current Token. Update it and try again.',
  },
  connectionFailed: {
    errorCode: 'CONNECTION_FAILED',
    errorMessage: 'Unable to connect to Tencent Docs. Try again later.',
  },
  connectionLost: {
    errorCode: 'CONNECTION_LOST',
    errorMessage: 'The Tencent Docs connection was lost. Try again.',
  },
  disconnectFailed: {
    errorCode: 'DISCONNECT_FAILED',
    errorMessage: 'Unable to disconnect from Tencent Docs. Try again.',
  },
} as const satisfies Record<string, Failure>

const NO_FAILURE: Failure = { errorCode: null, errorMessage: null }

function isAuthRejection(value: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = value
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break
    seen.add(current)
    if (typeof current === 'string' || typeof current === 'number') {
      const text = String(current).toUpperCase()
      return text.includes('401')
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

function safeFailure(value: unknown): Failure {
  if (isCredentialMissing(value)) return FAILURE.credentialMissing
  if (isAuthRejection(value)) return FAILURE.authRejected
  return FAILURE.connectionFailed
}

function serverFrom(snapshot: McpRuntimeSnapshot): McpServerSnapshot | undefined {
  return snapshot.servers.find(server => server.serverName === TENCENT_DOCS_MCP_SERVER_NAME)
}

/** Remote service that owns the explicit Tencent Docs connection gesture. */
export class TencentDocsConnectorGateway extends TypertRemoteService {
  static inject = ['credentials', 'mcp']

  private snapshot: TencentDocsConnectorSnapshot = {
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

  constructor(ctx: Context) {
    super(ctx, 'tencentDocsConnector')

    ctx.effect(() => async () => {
      this.disposed = true
      this.connectionRequested = false
      await this.operations
      if (serverFrom(this.ctx.mcp.snapshot()) !== undefined) {
        await this.ctx.mcp.disconnect(TENCENT_DOCS_MCP_SERVER_NAME)
      }
    }, 'tencent-docs-connector: MCP teardown')

    ctx.on('credentials/updated', (ref) => {
      if (ref !== TENCENT_DOCS_MCP_CREDENTIAL_REF) return
      void this.enqueue(async () => { await this.handleCredentialUpdate() })
    })
    ctx.on('mcp/change', (snapshot) => {
      this.reconcileMcp(snapshot)
    })

    ctx.effect(async () => {
      await this.enqueue(async () => { await this.refreshCredentialState(false) })
      return () => {}
    }, 'tencent-docs-connector: initial credential description')
  }

  /**
   * Refresh safe credential metadata and read the complete connector state.
   * @returns the complete current connector state after the refresh.
   */
  @Remote('get')
  async get(): Promise<TencentDocsConnectorSnapshot> {
    return this.enqueue(async () => {
      if (await this.refreshCredentialState(false) && !this.disposed) {
        this.reconcileMcp(this.ctx.mcp.snapshot())
      }
      return this.copySnapshot()
    })
  }

  /**
   * Read the connector fields approved for trusted non-loopback Web clients.
   *
   * The call does not refresh or expose credential configuration, source,
   * writability, or value.
   * @returns a detached snapshot containing only lifecycle status, tool count,
   * stable safe failure fields, and the update timestamp.
   */
  @Remote('publicGet')
  async publicGet(): Promise<TencentDocsConnectorEventSnapshot> {
    return this.eventSnapshot()
  }

  /**
   * Connect the fixed Tencent Docs MCP endpoint through the configured credential reference.
   * @returns the complete state after the connection attempt settles.
   */
  @Remote('connect')
  async connect(): Promise<TencentDocsConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.copySnapshot()
      this.connectionRequested = true
      const credential = await this.readCredentialState()
      if (this.disposed) return this.copySnapshot()
      if (credential === undefined) return this.copySnapshot()
      if (!credential.credentialConfigured) {
        if (!await this.disconnectExistingServer()) return this.copySnapshot()
        this.publishStatus('failed', 0, FAILURE.credentialMissing)
        return this.copySnapshot()
      }

      this.publishStatus('connecting', 0, NO_FAILURE)
      if (!await this.disconnectExistingServer()) return this.copySnapshot()
      try {
        const server = await this.ctx.mcp.connect({
          serverName: TENCENT_DOCS_MCP_SERVER_NAME,
          transport: {
            kind: 'streamable-http',
            url: TENCENT_DOCS_MCP_ENDPOINT,
            authorization: {
              kind: 'credential',
              ref: TENCENT_DOCS_MCP_CREDENTIAL_REF,
              scheme: 'raw',
            },
          },
        })
        if (!this.disposed) this.publishServer(server)
      } catch (error: unknown) {
        if (!this.disposed) {
          const failed = serverFrom(this.ctx.mcp.snapshot())
          if (failed?.status === 'failed'
            && (failed.errorCode !== undefined || failed.errorMessage !== undefined)) this.publishServer(failed)
          else this.publishStatus('failed', 0, safeFailure(error))
        }
      }
      return this.copySnapshot()
    })
  }

  /**
   * Disconnect Tencent Docs and wait for its MCP transport generation to quiesce.
   * @returns the complete state after disconnection settles.
   */
  @Remote('disconnect')
  async disconnect(): Promise<TencentDocsConnectorSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) return this.copySnapshot()
      this.connectionRequested = false
      const server = serverFrom(this.ctx.mcp.snapshot())
      if (server === undefined) {
        this.publishStatus('disconnected', 0, NO_FAILURE)
        return this.copySnapshot()
      }
      this.publishStatus('disconnecting', 0, NO_FAILURE)
      try {
        await this.ctx.mcp.disconnect(TENCENT_DOCS_MCP_SERVER_NAME)
        if (!this.disposed) this.publishStatus('disconnected', 0, NO_FAILURE)
      } catch {
        if (!this.disposed) this.publishStatus('failed', 0, FAILURE.disconnectFailed)
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
      const info = await this.ctx.credentials.describe(TENCENT_DOCS_MCP_CREDENTIAL_REF)
      const configured = await this.ctx.credentials.resolve(TENCENT_DOCS_MCP_CREDENTIAL_REF) !== undefined
      const state: CredentialState = {
        credentialConfigured: configured,
        credentialSource: configured ? info.source ?? null : null,
        credentialWritable: info.writable,
      }
      this.publishCredentialState(state)
      return state
    } catch {
      this.publishStatus('failed', 0, FAILURE.credentialLookup)
      return undefined
    }
  }

  private async refreshCredentialState(resolveValue: boolean): Promise<boolean> {
    try {
      const info = await this.ctx.credentials.describe(TENCENT_DOCS_MCP_CREDENTIAL_REF)
      const configured = resolveValue
        ? await this.ctx.credentials.resolve(TENCENT_DOCS_MCP_CREDENTIAL_REF) !== undefined
        : info.configured
      this.publishCredentialState({
        credentialConfigured: configured,
        credentialSource: configured ? info.source ?? null : null,
        credentialWritable: info.writable,
      })
      return true
    } catch {
      this.publishStatus('failed', 0, FAILURE.credentialLookup)
      return false
    }
  }

  private async handleCredentialUpdate(): Promise<void> {
    if (!await this.refreshCredentialState(true) || this.disposed) return
    if (!this.snapshot.credentialConfigured && this.connectionRequested) {
      if (await this.disconnectExistingServer() && !this.disposed) {
        this.publishStatus('failed', 0, FAILURE.credentialMissing)
      }
      return
    }
    const runtime = this.ctx.mcp.snapshot()
    if (this.connectionRequested && serverFrom(runtime) === undefined) return
    this.reconcileMcp(runtime)
  }

  private async disconnectExistingServer(): Promise<boolean> {
    if (serverFrom(this.ctx.mcp.snapshot()) === undefined) return true
    try {
      await this.ctx.mcp.disconnect(TENCENT_DOCS_MCP_SERVER_NAME)
      return true
    } catch {
      this.publishStatus('failed', 0, FAILURE.disconnectFailed)
      return false
    }
  }

  private reconcileMcp(runtime: McpRuntimeSnapshot): void {
    if (this.connectionRequested && !this.snapshot.credentialConfigured) {
      this.publishStatus('failed', 0, FAILURE.credentialMissing)
      return
    }
    const server = serverFrom(runtime)
    if (server !== undefined) {
      if (!this.connectionRequested && this.snapshot.status !== 'disconnecting') return
      if (this.snapshot.status === 'connecting' && server.status === 'disconnecting') return
      this.publishServer(server)
      return
    }
    if (this.snapshot.status === 'connecting' || this.snapshot.status === 'disconnecting') return
    if (this.connectionRequested) {
      this.publishStatus('failed', 0, FAILURE.connectionLost)
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
        this.publishStatus('failed', 0, safeFailure({
          code: server.errorCode,
          message: server.errorMessage,
        }))
        return
    }
  }

  private publishCredentialState(credential: CredentialState): void {
    this.publish({ ...this.snapshot, ...credential })
  }

  private publishStatus(status: TencentDocsConnectorStatus, toolCount: number, failure: Failure): void {
    this.publish({ ...this.snapshot, status, toolCount, ...failure })
  }

  private publish(next: Omit<TencentDocsConnectorSnapshot, 'updatedAt'>): void {
    const candidate = { ...next, updatedAt: new Date().toISOString() }
    if (this.sameState(candidate, this.snapshot)) return
    const publicChanged = !this.samePublicState(candidate, this.snapshot)
    this.snapshot = candidate
    if (!this.disposed && publicChanged) this.ctx.emit('tencent-docs-connector/change', this.eventSnapshot())
  }

  private sameState(left: TencentDocsConnectorSnapshot, right: TencentDocsConnectorSnapshot): boolean {
    return this.samePublicState(left, right)
      && left.credentialConfigured === right.credentialConfigured
      && left.credentialSource === right.credentialSource
      && left.credentialWritable === right.credentialWritable
  }

  private samePublicState(left: TencentDocsConnectorSnapshot, right: TencentDocsConnectorSnapshot): boolean {
    return left.status === right.status
      && left.toolCount === right.toolCount
      && left.errorCode === right.errorCode
      && left.errorMessage === right.errorMessage
  }

  private copySnapshot(): TencentDocsConnectorSnapshot {
    return { ...this.snapshot }
  }

  private eventSnapshot(): TencentDocsConnectorEventSnapshot {
    const { status, toolCount, errorCode, errorMessage, updatedAt } = this.snapshot
    return { status, toolCount, errorCode, errorMessage, updatedAt }
  }
}

export default TencentDocsConnectorGateway
