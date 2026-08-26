import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CredentialProvider, {
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { mcpServerName, type McpConnectRequest } from '@deepseek-ai/dsh-mcp'

const mocks = vi.hoisted(() => {
  class MockUnauthorizedError extends Error {}
  class MockStreamableHTTPError extends Error {
    constructor(readonly code: number) {
      super(`HTTP ${code}`)
    }
  }
  class MockStdioTransport {
    constructor(readonly options: Record<string, unknown>) {}
  }
  class MockHttpTransport {
    sessionId: string | undefined
    terminateSession = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    constructor(readonly url: URL, readonly options: {
      requestInit?: RequestInit
      fetch?: typeof fetch
    }) {}
  }
  type NotificationHandler = () => Promise<void>
  class MockClient {
    onclose: (() => void) | undefined
    readonly close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    readonly connect = vi.fn<(transport: unknown, options: unknown) => Promise<void>>(async (transport, options) => {
      await mocks.connectImpl(this, transport, options)
    })
    readonly request = vi.fn<(
      request: { method: string; params?: Record<string, unknown> },
      schema: unknown,
      options?: unknown,
    ) => Promise<unknown>>(
      async (request, schema, options) => await mocks.requestImpl(this, request, schema, options),
    )
    readonly handlers = new Map<unknown, NotificationHandler>()
    readonly setNotificationHandler = vi.fn((schema: unknown, handler: NotificationHandler) => {
      this.handlers.set(schema, handler)
    })

    constructor(..._args: unknown[]) {
      mocks.clients.push(this)
    }
  }
  const clients: MockClient[] = []
  const stdioTransports: MockStdioTransport[] = []
  const httpTransports: MockHttpTransport[] = []
  return {
    MockUnauthorizedError,
    MockStreamableHTTPError,
    MockStdioTransport,
    MockHttpTransport,
    MockClient,
    clients,
    stdioTransports,
    httpTransports,
    connectImpl: async (_client: MockClient, _transport: unknown, _options: unknown): Promise<void> => {},
    requestImpl: async (
      _client: MockClient,
      request: { method: string },
      _schema: unknown,
      _options: unknown,
    ): Promise<unknown> => {
      if (request.method === 'tools/list') return { tools: [] }
      if (request.method === 'tools/call') return { content: [{ type: 'text', text: 'ok' }] }
      throw new Error(`unexpected request ${request.method}`)
    },
  }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: mocks.MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ UnauthorizedError: mocks.MockUnauthorizedError }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class extends mocks.MockStdioTransport {
    constructor(options: Record<string, unknown>) {
      super(options)
      mocks.stdioTransports.push(this)
    }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPError: mocks.MockStreamableHTTPError,
  StreamableHTTPClientTransport: class extends mocks.MockHttpTransport {
    constructor(url: URL, options: { requestInit?: RequestInit; fetch?: typeof fetch }) {
      super(url, options)
      mocks.httpTransports.push(this)
    }
  },
}))

import McpClientRuntime, { Config } from '../src/runtime.ts'

class MemoryCredentials extends CredentialProvider {
  readonly values = new Map<CredentialRef, string>()

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.values.has(ref), writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.values.set(ref, value)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    this.values.delete(ref)
    return Promise.resolve()
  }
}

const SERVER = mcpServerName('test')
const TOKEN_REF = credentialRef('TEST_MCP_TOKEN')
const runtimeConfig = {
  connectTimeoutMs: 50,
  reconnectInitialDelayMs: 10,
  reconnectMaxDelayMs: 40,
  reconnectMaxAttempts: 2,
}

function stdioRequest(overrides: Partial<McpConnectRequest> = {}): McpConnectRequest {
  return {
    serverName: SERVER,
    transport: { kind: 'stdio', command: 'server', args: ['--stdio'] },
    ...overrides,
  }
}

function httpRequest(overrides: Partial<McpConnectRequest> = {}): McpConnectRequest {
  return {
    serverName: SERVER,
    transport: {
      kind: 'streamable-http',
      url: 'https://example.test/mcp',
      authorization: { kind: 'credential', ref: TOKEN_REF, scheme: 'raw' },
    },
    ...overrides,
  }
}

async function boot(): Promise<{ ctx: Context; credentials: MemoryCredentials; runtime: McpClientRuntime; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  const fiber = await ctx.plugin(McpClientRuntime, runtimeConfig)
  return {
    ctx,
    credentials: ctx.credentials as MemoryCredentials,
    runtime: ctx.mcp as McpClientRuntime,
    dispose: async () => { await fiber.dispose() },
  }
}

function listedTool(name = 'read', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    description: 'Read a document',
    inputSchema: { type: 'object' },
    ...extra,
  }
}

function callRequest(name = 'read', signal = new AbortController().signal) {
  return { serverName: SERVER, name, args: { id: 1 }, signal, timeoutMs: 100 }
}

describe('McpClientRuntime validation and transport construction', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.clients.length = 0
    mocks.stdioTransports.length = 0
    mocks.httpTransports.length = 0
    mocks.connectImpl = async () => {}
    mocks.requestImpl = async (_client, request) => {
      if (request.method === 'tools/list') return { tools: [] }
      return { content: [{ type: 'text', text: 'ok' }] }
    }
  })

  it('validates configuration and rejects use after disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    expect(() => new McpClientRuntime(ctx, { ...runtimeConfig, reconnectInitialDelayMs: 41 }))
      .toThrow(/must be less than or equal/)

    const { runtime, dispose } = await boot()
    await dispose()
    await expect(runtime.connect(stdioRequest())).rejects.toThrow(/stopping/)
  })

  it('rejects blank stdio commands and malformed or unsafe HTTP URLs', async () => {
    const { runtime } = await boot()
    await expect(runtime.connect({ serverName: SERVER, transport: { kind: 'stdio', command: '  ' } }))
      .rejects.toThrow(/must not be blank/)
    for (const url of [
      'not a URL',
      'file:///tmp/mcp',
      'https://user@example.test/mcp',
      'https://example.test/mcp#secret',
    ]) {
      await expect(runtime.connect({ serverName: SERVER, transport: { kind: 'streamable-http', url } }))
        .rejects.toThrow()
    }
    await expect(runtime.connect({
      serverName: SERVER,
      transport: { kind: 'streamable-http', url: 'https://example.test', headers: { AUTHORIZATION: 'secret' } },
    })).rejects.toThrow(/credential reference/)
    await expect(runtime.connect({
      serverName: SERVER,
      transport: { kind: 'streamable-http', url: 'https://example.test', headers: { 'X-Test': 'bad\nvalue' } },
    })).rejects.toThrow('MCP Streamable HTTP headers are invalid')
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('closes the client and releases its reserved name when transport construction fails', async () => {
    const { ctx, runtime } = await boot()
    const request = httpRequest({
      transport: { kind: 'streamable-http', url: 'https://example.test', headers: { 'X-Test': 'valid' } },
    })
    const headers = (request.transport as { headers: Record<string, string> }).headers
    let mutated = false
    ctx.on('mcp/change', () => {
      if (mutated) return
      mutated = true
      headers['X-Test'] = 'bad\nvalue'
    })

    await expect(runtime.connect(request)).rejects.toThrow('MCP transport could not be initialized')
    expect(mocks.clients).toHaveLength(1)
    expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('constructs stdio with scrubbed parent env, arguments, cwd, and configured secret redaction', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { toolResult: { message: 'prefix configured-secret suffix' }, isError: true }
    await runtime.connect({
      serverName: SERVER,
      transport: {
        kind: 'stdio',
        command: 'server',
        args: ['--one'],
        cwd: '/tmp',
        env: { MCP_TOKEN: 'configured-secret', NORMAL: 'visible' },
      },
    })
    expect(mocks.stdioTransports[0]?.options).toMatchObject({
      command: 'server', args: ['--one'], cwd: '/tmp', env: { MCP_TOKEN: 'configured-secret', NORMAL: 'visible' },
    })
    await expect(runtime.callTool(callRequest())).resolves.toEqual({
      content: [{ type: 'text', text: '{"message":"prefix [REDACTED] suffix"}' }],
      isError: true,
    })
  })

  it('uses empty stdio argument defaults and treats every explicit env value as sensitive', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { content: [{ type: 'text', text: 'plain-value secret-value' }] }
    await runtime.connect({
      serverName: SERVER,
      transport: { kind: 'stdio', command: 'server', env: { NORMAL: 'plain-value', API_SECRET: 'secret-value' } },
    })
    expect(mocks.stdioTransports[0]?.options).not.toHaveProperty('cwd')
    expect(mocks.stdioTransports[0]?.options.args).toEqual([])
    expect(JSON.stringify(await runtime.callTool(callRequest()))).toContain('[REDACTED] [REDACTED]')
  })

  it('uses an HTTP credential per request and remembers every rotated value', async () => {
    const { runtime, credentials } = await boot()
    await credentials.set(TOKEN_REF, 'token-0')
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : {
        content: [{ type: 'text', text: 'token-0 token-1 token-2 token-3 token-4 token-5' }],
        structuredContent: { newest: 'token-5' },
      }
    await runtime.connect(httpRequest())
    const transport = mocks.httpTransports[0]!
    expect(transport.url.href).toBe('https://example.test/mcp')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    for (let index = 0; index < 6; index += 1) {
      await credentials.set(TOKEN_REF, `token-${index}`)
      await transport.options.fetch!('https://example.test/mcp', { headers: { Existing: 'yes' } })
      expect(fetchMock.mock.calls[index]?.[1]?.headers).toEqual(expect.any(Headers))
      expect((fetchMock.mock.calls[index]?.[1]?.headers as Headers).get('Authorization')).toBe(`token-${index}`)
    }
    await credentials.set(TOKEN_REF, 'token-2')
    await transport.options.fetch!('https://example.test/mcp')
    await transport.options.fetch!('https://example.test/mcp')
    const result = await runtime.callTool(callRequest())
    expect(JSON.stringify(result)).not.toContain('token-')
    expect(JSON.stringify(result).match(/\[REDACTED\]/g)).toHaveLength(7)
  })

  it('adds the Bearer scheme at request time and redacts both credential forms', async () => {
    const { runtime, credentials } = await boot()
    await credentials.set(TOKEN_REF, 'kingsoft-token')
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { content: [{ type: 'text', text: 'kingsoft-token Bearer kingsoft-token' }] }
    await runtime.connect(httpRequest({
      transport: {
        kind: 'streamable-http',
        url: 'https://example.test/mcp',
        authorization: { kind: 'credential', ref: TOKEN_REF, scheme: 'bearer' },
      },
    }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    await mocks.httpTransports[0]!.options.fetch!('https://example.test/mcp')
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer kingsoft-token')
    expect(JSON.stringify(await runtime.callTool(callRequest()))).toBe(
      '{"content":[{"type":"text","text":"[REDACTED] [REDACTED]"}]}',
    )
  })

  it('reports a missing HTTP credential without leaking it', async () => {
    const { runtime } = await boot()
    mocks.connectImpl = async (_client, transport) => {
      await (transport as (typeof mocks.httpTransports)[number]).options.fetch!('https://example.test/mcp')
    }
    await expect(runtime.connect(httpRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CREDENTIAL_MISSING', errorMessage: 'The configured MCP credential is unavailable.',
    })
  })

  it('treats every explicit HTTP header value as sensitive', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { content: [{
        type: 'text',
        text: 'cookie-value proxy-value credential-value auth-value public-header',
      }] }
    await runtime.connect({
      serverName: SERVER,
      transport: {
        kind: 'streamable-http',
        url: 'http://example.test/mcp',
        headers: {
          Cookie: 'cookie-value',
          'Proxy-Authorization': 'proxy-value',
          'X-Credential': 'credential-value',
          AUTH: 'auth-value',
          Public: ' public-header ',
        },
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    await mocks.httpTransports[0]!.options.fetch!('http://example.test/mcp')
    expect(fetchMock).toHaveBeenCalledOnce()
    const result = JSON.stringify(await runtime.callTool(callRequest()))
    expect(result).not.toMatch(/cookie-value|proxy-value|credential-value|auth-value|public-header/)
    expect(result.match(/\[REDACTED\]/g)).toHaveLength(5)
  })
})

describe('McpClientRuntime catalog and calls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.clients.length = 0
    mocks.stdioTransports.length = 0
    mocks.httpTransports.length = 0
    mocks.connectImpl = async () => {}
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { content: [{ type: 'text', text: 'ok' }] }
  })

  it('publishes sorted immutable snapshots, complete descriptors, and pagination', async () => {
    const { ctx, runtime } = await boot()
    const snapshots: unknown[] = []
    ctx.on('mcp/change', snapshot => void snapshots.push(snapshot))
    let page = 0
    mocks.requestImpl = async (_client, request) => {
      if (request.method === 'tools/call') return { content: [{ type: 'text', text: 'ok' }] }
      page += 1
      return page === 1
        ? {
          tools: [listedTool('rich', {
            outputSchema: { type: 'object' },
            execution: { taskSupport: 'optional' },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          })],
          nextCursor: 'second',
        }
        : { tools: [{ name: 'plain', inputSchema: { type: 'object' } }] }
    }
    await runtime.connect(stdioRequest({ serverName: mcpServerName('z') }))
    await runtime.connect(stdioRequest({ serverName: mcpServerName('a') }))
    expect(runtime.snapshot().servers.map(server => server.serverName)).toEqual(['a', 'z'])
    expect(runtime.snapshot().servers[1]?.tools[0]).toEqual({
      name: 'rich',
      description: 'Read a document',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      taskSupport: 'optional',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    })
    expect(Object.isFrozen(runtime.snapshot())).toBe(true)
    expect(snapshots.length).toBeGreaterThan(2)
  })

  it('omits individual annotations that the server does not declare', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async () => ({ tools: [listedTool('sparse', { annotations: {} })] })
    await runtime.connect(stdioRequest())
    expect(runtime.snapshot().servers[0]?.tools[0]?.annotations).toEqual({})
  })

  it('runs an activation call before publishing the discovered catalog', async () => {
    const { ctx, runtime } = await boot()
    const snapshots: Array<{ servers: readonly { status: string; tools: readonly unknown[] }[] }> = []
    ctx.on('mcp/change', snapshot => void snapshots.push(snapshot))
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    let activationOptions: unknown
    mocks.requestImpl = async (_client, request, _schema, options) => {
      if (request.method === 'tools/list') return { tools: [listedTool('verify')] }
      activationOptions = options
      expect(request).toEqual({
        method: 'tools/call',
        params: { name: 'verify', arguments: { probe: 1 } },
      })
      return gate.promise
    }
    const classify = vi.fn(() => 'accepted' as const)
    const connecting = runtime.connect(stdioRequest({
      activationCheck: {
        toolName: 'verify',
        args: { probe: 1 },
        timeoutMs: 321,
        classify,
      },
    }))
    await vi.waitFor(() => { expect(mocks.clients[0]?.request).toHaveBeenCalledTimes(2) })
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'connecting', tools: [] })
    expect(snapshots.some(snapshot => snapshot.servers[0]?.status === 'connected')).toBe(false)
    expect(activationOptions).toEqual({ timeout: 321 })
    gate.resolve({ content: [{ type: 'text', text: 'verified' }], structuredContent: { code: 0 } })
    await expect(connecting).resolves.toMatchObject({ status: 'connected', tools: [{ name: 'verify' }] })
    expect(classify).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'verified' }],
      structuredContent: { code: 0 },
    })
  })

  it('fails activation closed for refusal, unusable results, and unsafe activation tools', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool('verify')] }
      : { content: [] }

    await expect(runtime.connect(stdioRequest({
      activationCheck: { toolName: 'verify', args: {}, timeoutMs: 10, classify: () => 'auth-rejected' },
    }))).resolves.toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED', tools: [] })
    expect(mocks.clients[0]?.close).toHaveBeenCalledOnce()
    await runtime.disconnect(SERVER)

    await expect(runtime.connect(stdioRequest({
      activationCheck: { toolName: 'verify', args: {}, timeoutMs: 10, classify: () => 'failed' },
    }))).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [] })
    await runtime.disconnect(SERVER)

    await expect(runtime.connect(stdioRequest({
      activationCheck: { toolName: 'missing', args: {}, timeoutMs: 10, classify: () => 'accepted' },
    }))).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [] })
    await runtime.disconnect(SERVER)

    mocks.requestImpl = async () => ({
      tools: [listedTool('verify', { execution: { taskSupport: 'required' } })],
    })
    await expect(runtime.connect(stdioRequest({
      activationCheck: { toolName: 'verify', args: {}, timeoutMs: 10, classify: () => 'accepted' },
    }))).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [] })
  })

  it('contains activation classifier failures without publishing provider data', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool('verify')] }
      : { content: [{ type: 'text', text: 'private activation result' }] }
    const snapshot = await runtime.connect(stdioRequest({
      activationCheck: {
        toolName: 'verify',
        args: {},
        timeoutMs: 10,
        classify: () => { throw new Error('private classifier failure') },
      },
    }))
    expect(snapshot).toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [] })
    expect(JSON.stringify(snapshot)).not.toMatch(/private|activation result|classifier/)
  })

  it('closes a generation whose activation finishes after disconnect', async () => {
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool('verify')] }
      : gate.promise
    const connecting = runtime.connect(stdioRequest({
      activationCheck: { toolName: 'verify', args: {}, timeoutMs: 10, classify: () => 'accepted' },
    }))
    await vi.waitFor(() => { expect(mocks.clients[0]?.request).toHaveBeenCalledTimes(2) })
    const disconnecting = runtime.disconnect(SERVER)
    await vi.waitFor(() => { expect(mocks.clients[0]?.close).toHaveBeenCalledOnce() })
    gate.resolve({ content: [] })
    await connecting
    await disconnecting
    expect(runtime.snapshot().servers).toEqual([])
    expect(mocks.clients[0]?.close).toHaveBeenCalledOnce()
  })

  it('redacts resolved credentials from every model-visible catalog string', async () => {
    const { runtime, credentials } = await boot()
    await credentials.set(TOKEN_REF, 'catalog-secret')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    mocks.requestImpl = async (_client, request) => {
      if (request.method !== 'tools/list') return { content: [] }
      await mocks.httpTransports[0]!.options.fetch!('https://example.test/mcp')
      return {
        tools: [listedTool('safe-name', {
          description: 'Read catalog-secret documents',
          inputSchema: {
            type: 'object',
            properties: { 'catalog-secret-field': { description: 'accepts catalog-secret' } },
          },
          outputSchema: {
            type: 'object',
            properties: { result: { const: 'catalog-secret' } },
          },
          execution: { taskSupport: 'optional' },
          annotations: { title: 'catalog-secret title', readOnlyHint: true },
        })],
      }
    }

    await expect(runtime.connect(httpRequest())).resolves.toMatchObject({ status: 'connected' })
    expect(runtime.snapshot().servers[0]?.tools[0]).toEqual({
      name: 'safe-name',
      description: 'Read [REDACTED] documents',
      inputSchema: {
        type: 'object',
        properties: { '[REDACTED]-field': { description: 'accepts [REDACTED]' } },
      },
      outputSchema: {
        type: 'object',
        properties: { result: { const: '[REDACTED]' } },
      },
      taskSupport: 'optional',
      annotations: { readOnlyHint: true },
    })
    expect(JSON.stringify(runtime.snapshot())).not.toContain('catalog-secret')
  })

  it('rejects catalogs whose tool name or task metadata contains a credential', async () => {
    const { runtime, credentials } = await boot()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    let advertised = listedTool('leak-secret-name')
    mocks.requestImpl = async (_client, request) => {
      if (request.method !== 'tools/list') return { content: [] }
      await mocks.httpTransports.at(-1)!.options.fetch!('https://example.test/mcp')
      return { tools: [advertised] }
    }

    await credentials.set(TOKEN_REF, 'secret-name')
    await expect(runtime.connect(httpRequest())).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'CONNECTION_FAILED',
      errorMessage: 'The MCP server could not be reached or initialized.',
    })
    expect(JSON.stringify(runtime.snapshot())).not.toContain('secret-name')
    await runtime.disconnect(SERVER)

    advertised = listedTool('safe', { execution: { taskSupport: 'required' } })
    await credentials.set(TOKEN_REF, 'required')
    await expect(runtime.connect(httpRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    expect(JSON.stringify(runtime.snapshot())).not.toContain('required')
  })

  it('rejects duplicate connection and duplicate tools without losing the failed snapshot', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async () => ({
      tools: [listedTool('duplicate'), listedTool('duplicate')],
    })
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    await expect(runtime.connect(stdioRequest())).rejects.toThrow(/already connected/)
  })

  it('rejects a catalog schema that cannot become a detached JSON object', async () => {
    const { runtime } = await boot()
    mocks.requestImpl = async () => ({ tools: [listedTool('invalid', { inputSchema: null })] })
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
  })

  it('rejects repeated cursors and bounded pagination with safe failures', async () => {
    const { runtime } = await boot()
    let calls = 0
    mocks.requestImpl = async () => {
      calls += 1
      return { tools: [], nextCursor: 'same' }
    }
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    expect(calls).toBe(2)
    await runtime.disconnect(SERVER)

    calls = 0
    mocks.requestImpl = async () => {
      calls += 1
      return { tools: [], nextCursor: `page-${calls}` }
    }
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    expect(calls).toBe(100)
  })

  it('applies one timeout budget to the complete tool catalog', async () => {
    vi.useFakeTimers()
    const { runtime } = await boot()
    let requestOptions: unknown
    mocks.requestImpl = async (_client, _request, _schema, options) => {
      requestOptions = options
      const signal = (options as { signal: AbortSignal }).signal
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('private timeout detail')) }, { once: true })
      })
    }
    const connecting = runtime.connect(stdioRequest())
    await vi.advanceTimersByTimeAsync(0)
    expect(requestOptions).toMatchObject({ timeout: 50, maxTotalTimeout: 50 })
    await vi.advanceTimersByTimeAsync(50)
    await expect(connecting).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    vi.useRealTimers()
  })

  it('stops pagination when the catalog deadline passes between pages', async () => {
    vi.useFakeTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async () => gate.promise
    const connecting = runtime.connect(stdioRequest())
    await vi.advanceTimersByTimeAsync(50)
    gate.resolve({ tools: [], nextCursor: 'late-page' })
    await expect(connecting).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', tools: [],
    })
    expect(mocks.clients[0]!.request).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('rejects calls when disconnected, unadvertised, or task execution is required', async () => {
    const { runtime } = await boot()
    await expect(runtime.callTool(callRequest())).rejects.toThrow(/not connected/)
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool('task', { execution: { taskSupport: 'required' } })] }
      : { content: [] }
    await runtime.connect(stdioRequest())
    await expect(runtime.callTool(callRequest('missing'))).rejects.toThrow(/does not advertise/)
    await expect(runtime.callTool(callRequest('task'))).rejects.toThrow(/requires task-based/)
  })

  it('normalizes canonical, legacy, empty, and invalid call results', async () => {
    const { runtime } = await boot()
    const results: unknown[] = [
      { content: [{ type: 'text', text: 'ok' }], structuredContent: { answer: 1 }, isError: true },
      {},
      { toolResult: undefined },
    ]
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : results.shift()
    await runtime.connect(stdioRequest())
    await expect(runtime.callTool(callRequest())).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }], structuredContent: { answer: 1 }, isError: true,
    })
    await expect(runtime.callTool(callRequest())).resolves.toEqual({ content: [{ type: 'text', text: '(no output)' }] })
    await expect(runtime.callTool(callRequest())).rejects.toThrow('MCP tool call failed')
  })

  it('normalizes cancellations, converts generic errors, and fails on authentication rejection', async () => {
    const { runtime } = await boot()
    const failures: unknown[] = [
      new Error('remote abort-secret detail'),
      new Error('server detail'),
      new mocks.MockUnauthorizedError('denied'),
    ]
    mocks.requestImpl = async (_client, request) => {
      if (request.method === 'tools/list') return { tools: [listedTool()] }
      throw failures.shift()
    }
    await runtime.connect({
      serverName: SERVER,
      transport: { kind: 'stdio', command: 'server', env: { AUTH: 'abort-secret' } },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(runtime.callTool(callRequest('read', controller.signal))).rejects.toThrow('MCP tool call was cancelled')
    await expect(runtime.callTool(callRequest())).rejects.toThrow('MCP tool call failed')
    mocks.clients[0]!.close.mockRejectedValueOnce(new Error('already closed'))
    await expect(runtime.callTool(callRequest())).rejects.toThrow('MCP authentication was rejected')
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED', tools: [] })
    expect(mocks.clients[0]?.close).toHaveBeenCalled()
  })
})

describe('McpClientRuntime notifications, recovery, and teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.restoreAllMocks()
    mocks.clients.length = 0
    mocks.stdioTransports.length = 0
    mocks.httpTransports.length = 0
    mocks.connectImpl = async () => {}
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : { content: [{ type: 'text', text: 'ok' }] }
  })

  it('serializes tool-list notifications, commits success, and reports refresh failure', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    const handler = [...mocks.clients[0]!.handlers.values()][0]!
    mocks.requestImpl = async () => ({ tools: [listedTool('new')] })
    await handler()
    expect(runtime.snapshot().servers[0]?.tools[0]?.name).toBe('new')

    mocks.requestImpl = async () => { throw new Error('catalog secret') }
    await handler()
    expect(runtime.snapshot().servers[0]).toMatchObject({
      status: 'connected', errorCode: 'TOOL_SYNC_FAILED', errorMessage: 'The MCP server tool catalog could not be refreshed.',
    })
  })

  it('contains a notification failure after the generation is disconnected', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    const handler = [...mocks.clients[0]!.handlers.values()][0]!
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async () => gate.promise
    const syncing = handler()
    await Promise.resolve()
    const disconnecting = runtime.disconnect(SERVER)
    gate.reject(new Error('late failure'))
    await syncing
    await disconnecting
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('ignores late notification results from a replaced generation and after disposal', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    const handler = [...mocks.clients[0]!.handlers.values()][0]!
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async () => gate.promise
    const syncing = handler()
    await Promise.resolve()
    const disconnecting = runtime.disconnect(SERVER)
    gate.resolve({ tools: [listedTool('late')] })
    await syncing
    await disconnecting
    await handler()
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('recovers a closed connection, ignores stale closes, and resets attempts after stability', async () => {
    const { runtime } = await boot()
    let activationChecks = 0
    await runtime.connect(stdioRequest({
      activationCheck: {
        toolName: 'read',
        args: {},
        timeoutMs: 25,
        classify: () => {
          activationChecks += 1
          return 'accepted'
        },
      },
    }))
    const first = mocks.clients[0]!
    await vi.advanceTimersByTimeAsync(50)
    first.onclose?.()
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'reconnecting', errorCode: 'CONNECTION_LOST' })
    await vi.advanceTimersByTimeAsync(10)
    expect(mocks.clients).toHaveLength(2)
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'connected', generation: 2 })
    expect(activationChecks).toBe(2)
    first.onclose?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.clients).toHaveLength(2)
  })

  it('classifies initial authentication and generic connection failures', async () => {
    const { runtime } = await boot()
    mocks.connectImpl = async () => { throw new mocks.MockStreamableHTTPError(403) }
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
    await runtime.disconnect(SERVER)
    mocks.connectImpl = async () => { throw new Error('private detail') }
    await expect(runtime.connect(stdioRequest())).resolves.toMatchObject({
      status: 'failed', errorCode: 'CONNECTION_FAILED', errorMessage: 'The MCP server could not be reached or initialized.',
    })
  })

  it('contains close rejection after a failed initial connection', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    mocks.connectImpl = async () => gate.promise
    const connecting = runtime.connect(stdioRequest())
    await vi.waitFor(() => { expect(mocks.clients).toHaveLength(1) })
    mocks.clients[0]!.close.mockRejectedValueOnce(new Error('already closed'))
    gate.reject(new Error('initialize failed'))
    await expect(connecting).resolves.toMatchObject({ status: 'failed', errorCode: 'CONNECTION_FAILED' })
  })

  it('closes and awaits a generation whose discovery finishes after disconnect', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async () => gate.promise
    const connecting = runtime.connect(stdioRequest())
    await vi.waitFor(() => { expect(mocks.clients).toHaveLength(1) })
    mocks.clients[0]!.close.mockRejectedValueOnce(new Error('already closed'))
    let disconnected = false
    const disconnecting = runtime.disconnect(SERVER).then(() => { disconnected = true })
    await vi.waitFor(() => { expect(mocks.clients[0]!.close).toHaveBeenCalledOnce() })
    expect(disconnected).toBe(false)
    gate.resolve({ tools: [] })
    await connecting
    await disconnecting
    expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('closes a discovery generation after its server name ownership is replaced', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async () => gate.promise
    type Connection = { disposed: boolean }
    type Internals = {
      connections: Map<string, Connection>
      remove(connection: Connection): Promise<void>
    }
    const internals = runtime as unknown as Internals
    const connecting = runtime.connect(stdioRequest())
    await vi.waitFor(() => { expect(mocks.clients[0]!.request).toHaveBeenCalledOnce() })
    const obsolete = internals.connections.get(SERVER)!
    internals.connections.set(SERVER, { disposed: true })
    gate.resolve({ tools: [] })
    await connecting
    expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
    internals.connections.delete(SERVER)
    await internals.remove(obsolete)
  })

  it('closes and awaits initialization without starting late discovery', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    mocks.connectImpl = async () => gate.promise
    const connecting = runtime.connect(stdioRequest())
    await vi.waitFor(() => { expect(mocks.clients).toHaveLength(1) })
    let disconnected = false
    const disconnecting = runtime.disconnect(SERVER).then(() => { disconnected = true })
    await vi.waitFor(() => { expect(mocks.clients[0]!.close).toHaveBeenCalledOnce() })
    expect(disconnected).toBe(false)
    gate.reject(new Error('late private initialize failure'))
    await connecting
    await disconnecting
    expect(mocks.clients[0]!.request).not.toHaveBeenCalled()
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('does not create a client after a lifecycle observer disconnects the pending generation', async () => {
    const { ctx, runtime } = await boot()
    let disconnecting: Promise<void> | undefined
    ctx.on('mcp/change', (snapshot) => {
      if (snapshot.servers[0]?.generation === 1) disconnecting = runtime.disconnect(SERVER)
    })
    await runtime.connect(stdioRequest())
    await disconnecting
    expect(mocks.clients).toHaveLength(0)
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('backs off failed recovery and stops after the attempt budget', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    mocks.connectImpl = async () => { throw new Error('offline') }
    mocks.clients[0]!.onclose?.()
    await vi.advanceTimersByTimeAsync(10)
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'reconnecting', generation: 2 })
    await vi.advanceTimersByTimeAsync(20)
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'failed', errorCode: 'RECONNECT_EXHAUSTED', generation: 3 })
  })

  it('stops recovery immediately when authentication fails', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    mocks.connectImpl = async () => { throw new mocks.MockUnauthorizedError('denied') }
    mocks.clients[0]!.onclose?.()
    await vi.advanceTimersByTimeAsync(10)
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: 'failed', errorCode: 'AUTH_REJECTED' })
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.clients).toHaveLength(2)
  })

  it('disconnects an HTTP session, ignores 405, warns on other termination failures, and is idempotent', async () => {
    vi.useRealTimers()
    const { ctx, runtime } = await boot()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await runtime.connect(httpRequest())
    const transport = mocks.httpTransports[0]!
    transport.sessionId = 'session'
    await runtime.disconnect(SERVER)
    expect(warn).not.toHaveBeenCalled()
    expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
    mocks.clients[0]!.onclose?.()
    await expect(transport.options.fetch!('https://example.test/mcp')).rejects.toThrow('MCP connection is stopping')
    await runtime.disconnect(SERVER)

    await runtime.connect(httpRequest())
    const unsupported = mocks.httpTransports[1]!
    unsupported.sessionId = 'session-2'
    unsupported.terminateSession.mockRejectedValueOnce(new mocks.MockStreamableHTTPError(405))
    await runtime.disconnect(SERVER)
    expect(warn).not.toHaveBeenCalled()

    await runtime.connect(httpRequest())
    const failed = mocks.httpTransports[2]!
    failed.sessionId = 'session-3'
    failed.terminateSession.mockRejectedValueOnce(new Error('private termination detail'))
    await runtime.disconnect(SERVER)
    expect(warn).toHaveBeenCalledWith('mcp-client(%s): remote session termination failed', SERVER)
  })

  it('bounds a hung HTTP session termination before closing the client', async () => {
    const { ctx, runtime } = await boot()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await runtime.connect(httpRequest())
    const transport = mocks.httpTransports[0]!
    transport.sessionId = 'hung-session'
    transport.terminateSession.mockReturnValueOnce(new Promise(() => {}))
    let disconnected = false
    const disconnecting = runtime.disconnect(SERVER).then(() => { disconnected = true })
    await vi.advanceTimersByTimeAsync(49)
    expect(disconnected).toBe(false)
    expect(mocks.clients[0]!.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await disconnecting
    expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('mcp-client(%s): remote session termination failed', SERVER)
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('contains client close rejection and coalesces overlapping disconnects', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    const closeGate: PromiseWithResolvers<void> = Promise.withResolvers()
    mocks.clients[0]!.close.mockImplementationOnce(() => closeGate.promise)
    let secondFinished = false
    const first = runtime.disconnect(SERVER)
    const second = runtime.disconnect(SERVER).then(() => { secondFinished = true })
    await vi.waitFor(() => { expect(mocks.clients[0]!.close).toHaveBeenCalledOnce() })
    expect(secondFinished).toBe(false)
    closeGate.resolve()
    await Promise.all([first, second])
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('ignores an authentication failure that arrives after disconnect', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : gate.promise
    await runtime.connect(stdioRequest())
    const call = runtime.callTool(callRequest())
    const disconnecting = runtime.disconnect(SERVER)
    gate.reject(new mocks.MockUnauthorizedError('late auth'))
    await expect(call).rejects.toThrow('MCP authentication was rejected')
    await disconnecting
  })

  it('waits for in-flight calls and suppresses late transport close during teardown', async () => {
    const { runtime } = await boot()
    const gate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mocks.requestImpl = async (_client, request) => request.method === 'tools/list'
      ? { tools: [listedTool()] }
      : gate.promise
    await runtime.connect(stdioRequest())
    const call = runtime.callTool(callRequest())
    const disconnect = runtime.disconnect(SERVER)
    mocks.clients[0]!.onclose?.()
    gate.resolve({ content: [{ type: 'text', text: 'done' }] })
    await call
    await disconnect
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('cancels pending reconnect and drains all connections on Host teardown', async () => {
    const { runtime, dispose } = await boot()
    await runtime.connect(stdioRequest({ serverName: mcpServerName('one') }))
    await runtime.connect(stdioRequest({ serverName: mcpServerName('two') }))
    mocks.clients[0]!.onclose?.()
    await dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(runtime.snapshot().servers).toEqual([])
    expect(mocks.clients).toHaveLength(2)
  })

  it('Host teardown closes and awaits a recovery generation still initializing', async () => {
    const { runtime, dispose } = await boot()
    await runtime.connect(stdioRequest())
    const first = mocks.clients[0]!
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    mocks.connectImpl = async (client) => {
      if (client !== first) await gate.promise
    }
    first.onclose?.()
    await vi.advanceTimersByTimeAsync(10)
    const recovery = mocks.clients[1]!
    let disposed = false
    const disposing = dispose().then(() => { disposed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(recovery.close).toHaveBeenCalledOnce()
    expect(disposed).toBe(false)
    gate.resolve()
    await disposing
    expect(recovery.request).not.toHaveBeenCalled()
    expect(runtime.snapshot().servers).toEqual([])
  })

  it('contains callbacks that race after their connection is disposed or replaced', async () => {
    const { runtime } = await boot()
    await runtime.connect(stdioRequest())
    type Connection = {
      disposed: boolean
      reconnectTimer: NodeJS.Timeout | undefined
      request: McpConnectRequest
    }
    type Internals = {
      connections: Map<string, Connection>
      connectGeneration(connection: Connection, initial: boolean): Promise<void>
      scheduleReconnect(connection: Connection): void
      connectionClosed(connection: Connection, client: unknown): void
      remove(connection: Connection): Promise<void>
    }
    const internals = runtime as unknown as Internals
    const connection = internals.connections.get(SERVER)!
    await runtime.disconnect(SERVER)
    await internals.connectGeneration(connection, false)
    internals.scheduleReconnect(connection)
    internals.connectionClosed(connection, mocks.clients[0])
    expect(mocks.clients).toHaveLength(1)
  })

  it('does not delete a newer map entry while removing an obsolete connection record', async () => {
    vi.useRealTimers()
    const { runtime } = await boot()
    type Connection = { disposed: boolean }
    type Internals = {
      connections: Map<string, Connection>
      remove(connection: Connection): Promise<void>
    }
    const internals = runtime as unknown as Internals
    await runtime.connect(stdioRequest())
    const obsolete = internals.connections.get(SERVER)!
    const closeGate: PromiseWithResolvers<void> = Promise.withResolvers()
    mocks.clients[0]!.close.mockImplementationOnce(() => closeGate.promise)
    const removing = internals.remove(obsolete)
    await Promise.resolve()
    internals.connections.set(SERVER, { disposed: true })
    closeGate.resolve()
    await removing
    expect(internals.connections.has(SERVER)).toBe(true)
  })
})

describe('runtime configuration schema', () => {
  it('defines production defaults', () => {
    expect(Config).toBeDefined()
  })
})
