/**
 * Host-owned dynamic MCP client provider for `ctx.mcp`.
 *
 * Unlike the package root's static one-server bridge, this provider keeps
 * transport ownership on the Host and publishes only safe tool descriptors.
 * Preset-scoped consumers decide which agents see those descriptors.
 *
 * @module @deepseek-ai/dsh-mcp-client/runtime
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ListToolsResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { z as zod } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import {
  McpRuntime,
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
  type McpStreamableHttpTransportConfig,
  type McpToolDescriptor,
} from '@deepseek-ai/dsh-mcp'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
// Side-effect type import: declaration-merges `ctx.credentials` onto Context.
import type {} from '@deepseek-ai/dsh-credentials'

/** Runtime recovery and connection budgets. */
export interface Config {
  /** Maximum time for MCP initialize or one complete tool catalog discovery. */
  connectTimeoutMs: number
  /** Delay before the first recovery attempt after an established connection closes. */
  reconnectInitialDelayMs: number
  /** Maximum recovery delay and stable-connection reset window. */
  reconnectMaxDelayMs: number
  /** Consecutive recovery attempts before the connection becomes failed. */
  reconnectMaxAttempts: number
}

/** Validated provider configuration. */
export const Config: Schema<Config> = Schema.object({
  connectTimeoutMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
  reconnectInitialDelayMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(500),
  reconnectMaxDelayMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
  reconnectMaxAttempts: Schema.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10),
})

const RawCallToolResultSchema = zod.record(zod.string(), zod.unknown())
const MAX_TOOL_LIST_PAGES = 100

class CredentialUnavailableError extends Error {
  constructor() {
    super('configured MCP credential is unavailable')
    this.name = 'CredentialUnavailableError'
  }
}

type ManagedConnection = {
  readonly request: McpConnectRequest
  status: McpServerSnapshot['status']
  generation: number
  tools: readonly McpToolDescriptor[]
  errorCode?: string
  errorMessage?: string
  client: Client | undefined
  transport: Transport | undefined
  connectingClient: Client | undefined
  connectingTransport: Transport | undefined
  connectTask: Promise<void>
  reconnectTimer: NodeJS.Timeout | undefined
  reconnectAttempts: number
  connectedAt: number | undefined
  disposed: boolean
  removeTask: Promise<void> | undefined
  syncChain: Promise<void>
  readonly inFlight: Set<Promise<unknown>>
  /** Every credential value seen by this connection; older in-flight responses may still echo one after rotation. */
  readonly secrets: string[]
}

/** Host provider that owns every dynamic MCP transport generation. */
export class McpClientRuntime extends McpRuntime {
  static inject = ['credentials']
  static Config: Schema<Config> = Config

  private readonly connections = new Map<string, ManagedConnection>()
  private readonly clientCloses = new WeakMap<Client, Promise<void>>()
  private revision = 0
  private disposed = false

  /**
   * @param ctx - Host context carrying credentials and lifecycle effects.
   * @param config - validated connection and recovery budgets.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (config.reconnectInitialDelayMs > config.reconnectMaxDelayMs) {
      throw new Error('mcp-client runtime: reconnectInitialDelayMs must be less than or equal to reconnectMaxDelayMs')
    }
    ctx.effect(() => async () => {
      this.disposed = true
      await Promise.all([...this.connections.values()].map(connection => this.remove(connection)))
    }, 'mcp-client runtime connections')
  }

  /** @inheritdoc */
  async connect(request: McpConnectRequest): Promise<McpServerSnapshot> {
    if (this.disposed) throw new Error('mcp-client runtime is stopping')
    if (this.connections.has(request.serverName)) {
      throw new Error(`MCP server "${request.serverName}" is already connected or must be disconnected before retrying`)
    }
    this.validateRequest(request)
    const connection: ManagedConnection = {
      request,
      status: 'connecting',
      generation: 0,
      tools: [],
      reconnectAttempts: 0,
      client: undefined,
      transport: undefined,
      connectingClient: undefined,
      connectingTransport: undefined,
      connectTask: Promise.resolve(),
      reconnectTimer: undefined,
      connectedAt: undefined,
      disposed: false,
      removeTask: undefined,
      syncChain: Promise.resolve(),
      inFlight: new Set(),
      secrets: [],
    }
    this.rememberConfiguredSecrets(connection)
    this.connections.set(request.serverName, connection)
    this.commit()
    await this.connectGeneration(connection, true)
    return this.serverSnapshot(connection)
  }

  /** @inheritdoc */
  async disconnect(serverName: McpServerName): Promise<void> {
    const connection = this.connections.get(serverName)
    if (connection === undefined) return
    await this.remove(connection)
  }

  /** @inheritdoc */
  snapshot(): McpRuntimeSnapshot {
    return deepFreeze({
      revision: this.revision,
      servers: [...this.connections.values()]
        .sort((left, right) => left.request.serverName.localeCompare(right.request.serverName))
        .map(connection => this.serverSnapshot(connection)),
    })
  }

  /** @inheritdoc */
  async callTool(request: McpCallToolRequest): Promise<McpResult> {
    const connection = this.connections.get(request.serverName)
    const client = connection?.client
    if (connection === undefined || connection.status !== 'connected' || client === undefined) {
      throw new Error(`MCP server "${request.serverName}" is not connected`)
    }
    const descriptor = connection.tools.find(tool => tool.name === request.name)
    if (descriptor === undefined) {
      throw new Error(`MCP server "${request.serverName}" does not advertise tool "${request.name}"`)
    }
    if (descriptor.taskSupport === 'required') {
      throw new Error(`MCP tool "${request.name}" requires task-based execution, which this runtime does not support`)
    }

    const operation = this.callCurrentTool(connection, client, request)
    connection.inFlight.add(operation)
    try {
      return await operation
    } finally {
      connection.inFlight.delete(operation)
    }
  }

  private async callCurrentTool(
    connection: ManagedConnection,
    client: Client,
    request: McpCallToolRequest,
  ): Promise<McpResult> {
    try {
      const raw = await client.request(
        { method: 'tools/call', params: { name: request.name, arguments: request.args } },
        RawCallToolResultSchema,
        { signal: request.signal, timeout: request.timeoutMs },
      )
      return this.normalizeResult(connection, raw)
    } catch (error) {
      if (request.signal.aborted) throw new Error('MCP tool call was cancelled')
      if (this.isAuthenticationError(error)) {
        await this.failAuthentication(connection, client)
        throw new Error('MCP authentication was rejected')
      }
      throw new Error('MCP tool call failed')
    }
  }

  private normalizeResult(connection: ManagedConnection, raw: Record<string, unknown>): McpResult {
    let candidate: unknown
    if (Array.isArray(raw.content)) {
      candidate = {
        content: raw.content,
        ...raw.structuredContent !== undefined ? { structuredContent: raw.structuredContent } : {},
        ...raw.isError === true ? { isError: true } : {},
      }
    } else {
      candidate = {
        content: [{
          type: 'text',
          text: 'toolResult' in raw ? JSON.stringify(raw.toolResult) : '(no output)',
        }],
        ...raw.isError === true ? { isError: true } : {},
      }
    }
    const detached = snapshotJsonValue(candidate)
    if (detached === undefined) throw new Error('MCP tool returned a value that is not lossless JSON')
    return deepFreeze(this.redactJson(detached as JsonValue, connection.secrets) as unknown as McpResult)
  }

  private async connectGeneration(connection: ManagedConnection, initial: boolean): Promise<void> {
    if (!this.ownsConnection(connection)) return
    connection.generation += 1
    connection.status = initial ? 'connecting' : 'reconnecting'
    delete connection.errorCode
    delete connection.errorMessage
    this.commit()
    if (!this.ownsConnection(connection)) return

    let client!: Client
    let transport!: Transport
    let established = false
    try {
      client = new Client({ name: 'dsh-mcp-client', version: '0.1.0' }, { capabilities: {} })
      connection.connectingClient = client
      transport = this.createTransport(connection)
      connection.connectingTransport = transport
      client.onclose = () => {
        if (established && this.isCurrentClient(connection, client)) this.connectionClosed(connection, client)
      }
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        const sync = connection.syncChain.then(async () => {
          if (!this.isCurrentClient(connection, client)) return
          const tools = await this.listTools(connection, client)
          if (!this.isCurrentClient(connection, client)) return
          connection.tools = tools
          delete connection.errorCode
          delete connection.errorMessage
          this.commit()
        })
        connection.syncChain = sync.catch(() => {})
        try {
          await sync
        } catch {
          if (this.isCurrentClient(connection, client)) {
            connection.errorCode = 'TOOL_SYNC_FAILED'
            connection.errorMessage = 'The MCP server tool catalog could not be refreshed.'
            this.commit()
          }
        }
      })

    } catch {
      await this.remove(connection)
      throw new Error('MCP transport could not be initialized')
    }
    const operation = this.runConnectGeneration(connection, client, transport, initial, () => {
      established = true
    })
    connection.connectTask = operation
    return operation
  }

  private async runConnectGeneration(
    connection: ManagedConnection,
    client: Client,
    transport: Transport,
    initial: boolean,
    markEstablished: () => void,
  ): Promise<void> {
    try {
      await client.connect(transport, { timeout: this.config.connectTimeoutMs })
      if (!this.ownsConnection(connection)) {
        await this.closeClient(connection, client, transport)
        return
      }
      const tools = await this.listTools(connection, client)
      if (!this.ownsConnection(connection)) {
        await this.closeClient(connection, client, transport)
        return
      }
      connection.client = client
      connection.transport = transport
      connection.tools = tools
      connection.status = 'connected'
      connection.connectedAt = Date.now()
      delete connection.errorCode
      delete connection.errorMessage
      markEstablished()
      this.commit()
    } catch (error) {
      await this.closeClient(connection, client, transport)
      if (connection.disposed) return
      const failure = this.failureFor(error)
      if (initial || failure.code === 'AUTH_REJECTED' || failure.code === 'CREDENTIAL_MISSING') {
        connection.status = 'failed'
        connection.tools = []
        connection.errorCode = failure.code
        connection.errorMessage = failure.message
        this.commit()
        return
      }
      this.scheduleReconnect(connection)
    } finally {
      connection.connectingClient = undefined
      connection.connectingTransport = undefined
    }
  }

  private connectionClosed(connection: ManagedConnection, client: Client): void {
    if (!this.isCurrentClient(connection, client)) return
    connection.client = undefined
    connection.transport = undefined
    connection.status = 'reconnecting'
    connection.errorCode = 'CONNECTION_LOST'
    connection.errorMessage = 'The MCP connection closed; recovery is in progress.'
    if (connection.connectedAt !== undefined
      && Date.now() - connection.connectedAt >= this.config.reconnectMaxDelayMs) {
      connection.reconnectAttempts = 0
    }
    connection.connectedAt = undefined
    this.commit()
    this.scheduleReconnect(connection)
  }

  private scheduleReconnect(connection: ManagedConnection): void {
    if (connection.disposed) return
    connection.reconnectAttempts += 1
    if (connection.reconnectAttempts > this.config.reconnectMaxAttempts) {
      connection.status = 'failed'
      connection.tools = []
      connection.errorCode = 'RECONNECT_EXHAUSTED'
      connection.errorMessage = 'The MCP connection could not be restored.'
      this.commit()
      return
    }
    connection.status = 'reconnecting'
    connection.errorCode = 'CONNECTION_LOST'
    connection.errorMessage = 'The MCP connection closed; recovery is in progress.'
    this.commit()
    const delayMs = Math.min(
      this.config.reconnectMaxDelayMs,
      this.config.reconnectInitialDelayMs * 2 ** (connection.reconnectAttempts - 1),
    )
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = undefined
      void this.connectGeneration(connection, false)
    }, delayMs)
    connection.reconnectTimer.unref()
  }

  private async failAuthentication(connection: ManagedConnection, client: Client): Promise<void> {
    if (!this.isCurrentClient(connection, client)) return
    const transport = connection.transport
    connection.client = undefined
    connection.transport = undefined
    connection.status = 'failed'
    connection.tools = []
    connection.errorCode = 'AUTH_REJECTED'
    connection.errorMessage = 'The MCP server rejected the configured credential.'
    this.commit()
    await this.closeClient(connection, client, transport)
  }

  private remove(connection: ManagedConnection): Promise<void> {
    if (connection.removeTask !== undefined) return connection.removeTask
    const deferred = Promise.withResolvers<void>()
    connection.removeTask = deferred.promise
    void this.runRemove(connection).then(deferred.resolve, deferred.reject)
    return deferred.promise
  }

  private async runRemove(connection: ManagedConnection): Promise<void> {
    connection.disposed = true
    if (connection.reconnectTimer !== undefined) {
      clearTimeout(connection.reconnectTimer)
      connection.reconnectTimer = undefined
    }
    connection.status = 'disconnecting'
    connection.tools = []
    delete connection.errorCode
    delete connection.errorMessage
    this.commit()
    const ownedClients = new Map<Client, Transport | undefined>()
    if (connection.client !== undefined) ownedClients.set(connection.client, connection.transport)
    if (connection.connectingClient !== undefined) {
      ownedClients.set(connection.connectingClient, connection.connectingTransport)
    }
    connection.client = undefined
    connection.transport = undefined
    await Promise.all([...ownedClients].map(async ([client, transport]) => {
      await this.closeClient(connection, client, transport)
    }))
    await Promise.allSettled([connection.connectTask])
    await connection.syncChain
    await Promise.allSettled([...connection.inFlight])
    connection.secrets.splice(0)
    if (this.connections.get(connection.request.serverName) === connection) {
      this.connections.delete(connection.request.serverName)
      this.commit()
    }
  }

  private closeClient(
    connection: ManagedConnection,
    client: Client,
    transport: Transport | undefined,
  ): Promise<void> {
    const existing = this.clientCloses.get(client)
    if (existing !== undefined) return existing
    client.onclose = () => {}
    const closing = (async () => {
      const streamable = transport instanceof StreamableHTTPClientTransport ? transport : undefined
      if (streamable?.sessionId !== undefined) {
        const termination = await this.terminateSession(streamable)
        if (termination !== undefined
          && !(termination instanceof StreamableHTTPError && termination.code === 405)) {
          this.ctx.logger.warn('mcp-client(%s): remote session termination failed', connection.request.serverName)
        }
      }
      try {
        await client.close()
      } catch {
        // The SDK may report an already-closed transport; no child work remains to recover from that rejection.
      }
    })()
    this.clientCloses.set(client, closing)
    return closing
  }

  private async terminateSession(streamable: StreamableHTTPClientTransport): Promise<unknown> {
    const settled = Promise.resolve().then(() => streamable.terminateSession()).then(
      () => undefined,
      (error: unknown) => error,
    )
    const timedOut = Promise.withResolvers<Error>()
    const timeout = setTimeout(
      () => { timedOut.resolve(new Error('MCP session termination timed out')) },
      this.config.connectTimeoutMs,
    )
    timeout.unref()
    try {
      return await Promise.race([settled, timedOut.promise])
    } finally {
      clearTimeout(timeout)
    }
  }

  private async listTools(connection: ManagedConnection, client: Client): Promise<readonly McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = []
    const names = new Set<string>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    const controller = new AbortController()
    const deadline = Date.now() + this.config.connectTimeoutMs
    const timeout = setTimeout(() => { controller.abort() }, this.config.connectTimeoutMs)
    timeout.unref()
    try {
      do {
        if (pages >= MAX_TOOL_LIST_PAGES) throw new Error('MCP tool catalog pagination limit exceeded')
        pages += 1
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) throw new Error('MCP tool catalog discovery timed out')
        const response = await client.request(
          { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
          ListToolsResultSchema,
          { signal: controller.signal, timeout: remainingMs, maxTotalTimeout: remainingMs },
        )
        for (const tool of response.tools) {
          if (names.has(tool.name)) throw new Error('MCP server listed a duplicate tool name')
          names.add(tool.name)
          tools.push({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: this.snapshotSchema(tool.inputSchema),
            ...tool.outputSchema === undefined ? {} : {
              outputSchema: this.snapshotSchema(tool.outputSchema),
            },
            ...tool.execution?.taskSupport === undefined ? {} : { taskSupport: tool.execution.taskSupport },
            ...tool.annotations === undefined ? {} : {
              annotations: {
                ...tool.annotations.readOnlyHint === undefined ? {} : { readOnlyHint: tool.annotations.readOnlyHint },
                ...tool.annotations.destructiveHint === undefined ? {} : { destructiveHint: tool.annotations.destructiveHint },
                ...tool.annotations.idempotentHint === undefined ? {} : { idempotentHint: tool.annotations.idempotentHint },
                ...tool.annotations.openWorldHint === undefined ? {} : { openWorldHint: tool.annotations.openWorldHint },
              },
            },
          })
        }
        const nextCursor = response.nextCursor
        if (nextCursor !== undefined && cursors.has(nextCursor)) {
          throw new Error('MCP server repeated a tool catalog cursor')
        }
        if (nextCursor !== undefined) cursors.add(nextCursor)
        cursor = nextCursor
      } while (cursor !== undefined)
      return deepFreeze(tools.map(tool => this.redactToolDescriptor(connection, tool)))
    } finally {
      clearTimeout(timeout)
    }
  }

  private snapshotSchema(value: unknown): Readonly<Record<string, unknown>> {
    const detached = snapshotJsonValue(value)
    if (detached === undefined || detached === null || typeof detached !== 'object' || Array.isArray(detached)) {
      throw new Error('MCP tool catalog contains a schema that is not lossless JSON')
    }
    return detached as Readonly<Record<string, unknown>>
  }

  private redactToolDescriptor(connection: ManagedConnection, tool: McpToolDescriptor): McpToolDescriptor {
    const name = this.redactString(tool.name, connection.secrets)
    if (name !== tool.name) throw new Error('MCP tool catalog contains sensitive data in a tool name')
    if (tool.taskSupport !== undefined
      && this.redactString(tool.taskSupport, connection.secrets) !== tool.taskSupport) {
      throw new Error('MCP tool catalog contains sensitive data in task support metadata')
    }
    return deepFreeze({
      name,
      description: this.redactString(tool.description, connection.secrets),
      inputSchema: this.redactJson(tool.inputSchema as JsonValue, connection.secrets) as Readonly<Record<string, unknown>>,
      ...tool.outputSchema === undefined ? {} : {
        outputSchema: this.redactJson(
          tool.outputSchema as JsonValue,
          connection.secrets,
        ) as Readonly<Record<string, unknown>>,
      },
      ...tool.taskSupport === undefined ? {} : { taskSupport: tool.taskSupport },
      ...tool.annotations === undefined ? {} : { annotations: tool.annotations },
    })
  }

  private createTransport(connection: ManagedConnection): Transport {
    const transport = connection.request.transport
    switch (transport.kind) {
      case 'stdio':
        return new StdioClientTransport({
          command: transport.command,
          args: [...transport.args ?? []],
          env: { ...scrubbedParentEnv(), ...transport.env },
          ...transport.cwd === undefined ? {} : { cwd: transport.cwd },
        })
      case 'streamable-http': {
        const url = this.validateHttpUrl(transport)
        const requestHeaders = new Headers(transport.headers)
        const dynamicFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
          if (connection.disposed) throw new Error('MCP connection is stopping')
          const headers = new Headers(init?.headers)
          if (transport.authorization !== undefined) {
            const resolved = await this.ctx.credentials.resolve(transport.authorization.ref)
            if (resolved === undefined) throw new CredentialUnavailableError()
            this.rememberSecret(connection, resolved.value)
            const authorization = transport.authorization.scheme === 'bearer'
              ? `Bearer ${resolved.value}`
              : resolved.value
            headers.set('Authorization', authorization)
            this.rememberSecret(connection, authorization)
          }
          return fetch(input, { ...init, headers })
        }
        return new StreamableHTTPClientTransport(url, {
          requestInit: { headers: requestHeaders },
          fetch: dynamicFetch,
        }) as Transport
      }
    }
  }

  private validateRequest(request: McpConnectRequest): void {
    switch (request.transport.kind) {
      case 'stdio':
        if (request.transport.command.trim() === '') throw new Error('MCP stdio command must not be blank')
        return
      case 'streamable-http':
        this.validateHttpUrl(request.transport)
        try {
          new Headers(request.transport.headers)
        } catch {
          throw new Error('MCP Streamable HTTP headers are invalid')
        }
        for (const name of Object.keys(request.transport.headers ?? {})) {
          if (name.toLowerCase() === 'authorization') {
            throw new Error('MCP Authorization must use a credential reference, not a literal header')
          }
        }
        return
    }
  }

  private validateHttpUrl(transport: McpStreamableHttpTransportConfig): URL {
    const url = new URL(transport.url)
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username !== '' || url.password !== '' || url.hash !== '') {
      throw new Error('MCP Streamable HTTP URL must be an HTTP(S) URL without credentials or a fragment')
    }
    return url
  }

  private rememberConfiguredSecrets(connection: ManagedConnection): void {
    const transport = connection.request.transport
    if (transport.kind === 'stdio') {
      for (const value of Object.values(transport.env ?? {})) this.rememberSecret(connection, value)
      return
    }
    for (const value of Object.values(transport.headers ?? {})) this.rememberSecret(connection, value)
    new Headers(transport.headers).forEach((value) => { this.rememberSecret(connection, value) })
  }

  private rememberSecret(connection: ManagedConnection, value: string): void {
    if (value === '' || connection.secrets[0] === value) return
    const existing = connection.secrets.indexOf(value)
    if (existing >= 0) connection.secrets.splice(existing, 1)
    connection.secrets.unshift(value)
  }

  private redactJson(value: JsonValue, secrets: readonly string[]): JsonValue {
    if (typeof value === 'string') return this.redactString(value, secrets)
    if (Array.isArray(value)) return value.map(item => this.redactJson(item, secrets))
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        this.redactString(key, secrets),
        this.redactJson(item, secrets),
      ]))
    }
    return value
  }

  private redactString(value: string, secrets: readonly string[]): string {
    let redacted = value
    for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
      redacted = redacted.split(secret).join('[REDACTED]')
    }
    return redacted
  }

  private ownsConnection(connection: ManagedConnection): boolean {
    return !connection.disposed && this.connections.get(connection.request.serverName) === connection
  }

  private isCurrentClient(connection: ManagedConnection, client: Client): boolean {
    return this.ownsConnection(connection) && connection.client === client
  }

  private isAuthenticationError(error: unknown): boolean {
    return error instanceof UnauthorizedError
      || (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
  }

  private failureFor(error: unknown): { code: string; message: string } {
    if (error instanceof CredentialUnavailableError) {
      return { code: 'CREDENTIAL_MISSING', message: 'The configured MCP credential is unavailable.' }
    }
    if (this.isAuthenticationError(error)) {
      return { code: 'AUTH_REJECTED', message: 'The MCP server rejected the configured credential.' }
    }
    return { code: 'CONNECTION_FAILED', message: 'The MCP server could not be reached or initialized.' }
  }

  private serverSnapshot(connection: ManagedConnection): McpServerSnapshot {
    return deepFreeze({
      serverName: connection.request.serverName,
      status: connection.status,
      generation: connection.generation,
      tools: connection.tools,
      ...connection.errorCode === undefined ? {} : { errorCode: connection.errorCode },
      ...connection.errorMessage === undefined ? {} : { errorMessage: connection.errorMessage },
    })
  }

  private commit(): void {
    this.revision += 1
    this.notifyChange()
  }
}

export default McpClientRuntime
