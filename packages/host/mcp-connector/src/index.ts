/** Shared Host lifecycle for explicit user-managed MCP connections. */

import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {
  McpRuntimeSnapshot,
  McpServerSnapshot,
} from '@deepseek-ai/dsh-mcp'
import type {
  McpConnectorDefinition,
  McpConnectorEventSnapshot,
  McpConnectorFailure,
  McpConnectorFailures,
  McpConnectorId,
  McpConnectorPublicView,
  McpConnectorSnapshot,
  McpConnectorStatus,
  McpConnectorView,
  McpConnectorsPublicSnapshot,
  McpConnectorsSnapshot,
} from './types.ts'
import { mcpConnectorId } from './types.ts'
import { mcpServerName } from '@deepseek-ai/dsh-mcp'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export type * from './types.ts'

/** Deployment configuration for one Token-authenticated hosted MCP product. */
export interface ManagedMcpConnectorConfig {
  /** Stable lowercase connector identity. */
  id: string
  /** Streamable HTTP MCP endpoint. */
  endpoint: string
  /** Host credential reference name. */
  credentialRef: string
  /** Process-wide MCP server name used in projected tool names. */
  serverName: string
  /** Transformation applied to the resolved credential. */
  authorizationScheme: 'raw' | 'bearer'
  /** Short text mark rendered in the connector avatar. */
  logo: string
  /** Simplified Chinese product name. */
  nameZh: string
  /** English product name. */
  nameEn: string
  /** Simplified Chinese capability summary. */
  descriptionZh: string
  /** English capability summary. */
  descriptionEn: string
  /** Simplified Chinese credential name. */
  credentialNameZh: string
  /** English credential name. */
  credentialNameEn: string
  /** Provider-owned credential setup page. */
  credentialHelpUrl: string
  /** Simplified Chinese setup-link copy. */
  credentialHelpLabelZh: string
  /** English setup-link copy. */
  credentialHelpLabelEn: string
}

/** Configuration for the process-wide managed MCP connector gateway. */
export interface Config {
  /** Token-authenticated hosted MCP products available in this deployment. */
  connectors: ManagedMcpConnectorConfig[]
}

const localized = {
  logo: Schema.string().min(1).max(4),
  nameZh: Schema.string().min(1),
  nameEn: Schema.string().min(1),
  descriptionZh: Schema.string().min(1),
  descriptionEn: Schema.string().min(1),
  credentialNameZh: Schema.string().min(1),
  credentialNameEn: Schema.string().min(1),
  credentialHelpUrl: Schema.string().min(1),
  credentialHelpLabelZh: Schema.string().min(1),
  credentialHelpLabelEn: Schema.string().min(1),
}

/** Validated managed MCP connector deployment configuration. */
export const Config: Schema<Config> = Schema.object({
  connectors: Schema.array(Schema.object({
    id: Schema.string().min(1),
    endpoint: Schema.string().min(1),
    credentialRef: Schema.string().min(1),
    serverName: Schema.string().min(1),
    authorizationScheme: Schema.union(['raw', 'bearer']),
    ...localized,
  })).default([]),
})

type CredentialState = Pick<
  McpConnectorSnapshot,
  'credentialConfigured' | 'credentialSource' | 'credentialWritable'
>

const NO_FAILURE: McpConnectorFailure = { errorCode: null, errorMessage: null }

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
 * Owns one connector's serialized credential and MCP lifecycle. The catalog
 * gateway delegates an id-selected Remote mutation to this instance.
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
      if (this.isDisposed()) {
        this.publishStatus('failed', 0, this.definition.failures.credentialLookup)
        return this.copySnapshot()
      }
      if (credential === undefined) return this.copySnapshot()
      if (!credential.credentialConfigured) {
        if (!await this.disconnectExistingServer()) return this.copySnapshot()
        this.publishStatus('failed', 0, this.definition.failures.credentialMissing)
        return this.copySnapshot()
      }

      this.publishStatus('connecting', 0, NO_FAILURE)
      if (!await this.disconnectExistingServer()) return this.copySnapshot()
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
        if (!this.isDisposed()) this.publishServer(server)
      } catch (error: unknown) {
        if (!this.isDisposed()) {
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
        if (!this.isDisposed()) this.publishStatus('disconnected', 0, NO_FAILURE)
      } catch {
        if (!this.isDisposed()) this.publishStatus('failed', 0, this.definition.failures.disconnectFailed)
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
    if (!await this.refreshCredentialState(true) || this.isDisposed()) return
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

  private isDisposed(): boolean {
    return this.disposed
  }

  private safeFailure(value: unknown): McpConnectorFailure {
    if (isCredentialMissing(value)) return this.definition.failures.credentialMissing
    if (isAuthRejection(value)) return this.definition.failures.authRejected
    return this.definition.failures.connectionFailed
  }
}

interface ManagedConnector {
  readonly id: McpConnectorId
  readonly credentialRef: ReturnType<typeof credentialRef>
  readonly presentation: McpConnectorView['presentation']
  readonly lifecycle: McpConnectorLifecycle
}

const CONNECTOR_ID = /^[a-z][a-z0-9-]*$/
const SERVER_NAME = /^[a-z][a-z0-9_]*$/
const CREDENTIAL_REF = /^[A-Z][A-Z0-9_]*$/

function requireHttps(raw: string, field: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`managed MCP connector ${field} must be an absolute HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`managed MCP connector ${field} must be an absolute HTTPS URL`)
  }
  return url.toString()
}

function connectorFailures(name: string, credentialName: string): McpConnectorFailures {
  return {
    credentialMissing: {
      errorCode: 'CREDENTIAL_MISSING',
      errorMessage: `Save ${credentialName} before connecting to ${name}.`,
    },
    credentialLookup: {
      errorCode: 'CREDENTIAL_LOOKUP_FAILED',
      errorMessage: `Unable to read the ${name} credential configuration.`,
    },
    authRejected: {
      errorCode: 'AUTH_REJECTED',
      errorMessage: `${name} rejected the current credential. Update it and try again.`,
    },
    connectionFailed: {
      errorCode: 'CONNECTION_FAILED',
      errorMessage: `Unable to connect to ${name}. Try again later.`,
    },
    connectionLost: {
      errorCode: 'CONNECTION_LOST',
      errorMessage: `The ${name} connection was lost. Try again.`,
    },
    disconnectFailed: {
      errorCode: 'DISCONNECT_FAILED',
      errorMessage: `Unable to disconnect from ${name}. Try again.`,
    },
  }
}

function validateConnectorConfig(
  config: ManagedMcpConnectorConfig,
  ids: Set<string>,
  servers: Set<string>,
  credentials: Set<string>,
): void {
  if (!CONNECTOR_ID.test(config.id)) throw new Error(`invalid managed MCP connector id: ${config.id}`)
  if (!SERVER_NAME.test(config.serverName)) throw new Error(`invalid managed MCP server name: ${config.serverName}`)
  if (!CREDENTIAL_REF.test(config.credentialRef)) {
    throw new Error(`invalid managed MCP credential reference: ${config.credentialRef}`)
  }
  for (const [set, value, kind] of [
    [ids, config.id, 'id'],
    [servers, config.serverName, 'server name'],
    [credentials, config.credentialRef, 'credential reference'],
  ] as const) {
    if (set.has(value)) throw new Error(`duplicate managed MCP connector ${kind}: ${value}`)
    set.add(value)
  }
  requireHttps(config.endpoint, 'endpoint')
  requireHttps(config.credentialHelpUrl, 'credential help URL')
}

/** Remote gateway for every configured Token-authenticated hosted MCP product. */
export class McpConnectorsGateway extends TypertRemoteService {
  static inject = ['credentials', 'mcp']
  static Config: Schema<Config> = Config

  private readonly connectors: readonly ManagedConnector[]

  /**
   * @param ctx - Host context carrying credential and dynamic MCP services.
   * @param config - validated deployment-owned connector definitions.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpConnectors')
    const ids = new Set<string>()
    const servers = new Set<string>()
    const credentials = new Set<string>()
    for (const connector of config.connectors) validateConnectorConfig(connector, ids, servers, credentials)

    const managed: ManagedConnector[] = []
    for (const connector of config.connectors) {
      const id = mcpConnectorId(connector.id)
      const ref = credentialRef(connector.credentialRef)
      const presentation: McpConnectorView['presentation'] = {
        logo: connector.logo,
        name: { zh: connector.nameZh, en: connector.nameEn },
        description: { zh: connector.descriptionZh, en: connector.descriptionEn },
        credentialName: { zh: connector.credentialNameZh, en: connector.credentialNameEn },
        credentialHelpUrl: requireHttps(connector.credentialHelpUrl, 'credential help URL'),
        credentialHelpLabel: {
          zh: connector.credentialHelpLabelZh,
          en: connector.credentialHelpLabelEn,
        },
      }
      const lifecycle = new McpConnectorLifecycle(ctx, {
        effectName: `mcp-connectors:${connector.id}`,
        endpoint: requireHttps(connector.endpoint, 'endpoint'),
        credentialRef: ref,
        serverName: mcpServerName(connector.serverName),
        authorizationScheme: connector.authorizationScheme,
        failures: connectorFailures(connector.nameEn, connector.credentialNameEn),
      }, () => { ctx.emit('mcp-connectors/change', this.publicSnapshot()) })
      managed.push({ id, credentialRef: ref, presentation, lifecycle })
    }
    this.connectors = managed
  }

  /** Read the complete connector catalog after refreshing credential metadata.
   * @returns the refreshed loopback-only catalog.
   */
  @Remote('list')
  async list(): Promise<McpConnectorsSnapshot> {
    return {
      connectors: await Promise.all(this.connectors.map(async connector => this.fullView(
        connector,
        await connector.lifecycle.get(),
      ))),
    }
  }

  /** Read the value-free connector catalog approved for trusted non-loopback clients.
   * @returns the current public catalog.
   */
  @Remote('publicList')
  publicList(): Promise<McpConnectorsPublicSnapshot> {
    return Promise.resolve(this.publicSnapshot())
  }

  /**
   * Connect one configured MCP product.
   * @param id - deployment-owned connector identity.
   * @returns the complete connector view after the attempt settles.
   */
  @Remote('connect')
  async connect(id: McpConnectorId): Promise<McpConnectorView> {
    const connector = this.requireConnector(id)
    return this.fullView(connector, await connector.lifecycle.connect())
  }

  /**
   * Disconnect one configured MCP product.
   * @param id - deployment-owned connector identity.
   * @returns the complete connector view after disconnection settles.
   */
  @Remote('disconnect')
  async disconnect(id: McpConnectorId): Promise<McpConnectorView> {
    const connector = this.requireConnector(id)
    return this.fullView(connector, await connector.lifecycle.disconnect())
  }

  private requireConnector(id: McpConnectorId): ManagedConnector {
    const connector = this.connectors.find(candidate => candidate.id === id)
    if (connector === undefined) throw new Error(`unknown managed MCP connector: ${id}`)
    return connector
  }

  private fullView(connector: ManagedConnector, snapshot: McpConnectorSnapshot): McpConnectorView {
    return {
      id: connector.id,
      credentialRef: connector.credentialRef,
      presentation: connector.presentation,
      snapshot,
    }
  }

  private publicSnapshot(): McpConnectorsPublicSnapshot {
    return {
      connectors: this.connectors.map((connector): McpConnectorPublicView => ({
        id: connector.id,
        presentation: connector.presentation,
        snapshot: connector.lifecycle.publicGet(),
      })),
    }
  }
}

export default McpConnectorsGateway
