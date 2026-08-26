import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import {
  McpRuntime,
  type McpCallToolRequest,
  type McpConnectRequest,
  type McpResult,
  type McpRuntimeSnapshot,
  type McpServerName,
  type McpServerSnapshot,
} from '@deepseek-ai/dsh-mcp'
import McpConnectorsGateway, { type Config } from '../src/index.ts'

class MemoryCredentials extends CredentialProvider {
  override resolve(ref: CredentialRef): Promise<ResolvedCredential> {
    return Promise.resolve({ value: `secret-for-${ref}`, source: 'memory' })
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: true, source: 'memory', writable: true })
  }

  override set(): Promise<void> { return Promise.resolve() }
  override unset(): Promise<void> { return Promise.resolve() }
}

class FakeMcpRuntime extends McpRuntime {
  readonly connects: McpConnectRequest[] = []
  private state: McpRuntimeSnapshot = { revision: 0, servers: [] }

  override connect(request: McpConnectRequest): Promise<McpServerSnapshot> {
    this.connects.push(request)
    const server: McpServerSnapshot = {
      serverName: request.serverName,
      status: 'connected',
      generation: 1,
      tools: [{ name: 'search', description: 'Search documents', inputSchema: { type: 'object' } }],
    }
    this.state = { revision: this.state.revision + 1, servers: [...this.state.servers, server] }
    this.notifyChange()
    return Promise.resolve(server)
  }

  override disconnect(serverName: McpServerName): Promise<void> {
    this.state = {
      revision: this.state.revision + 1,
      servers: this.state.servers.filter(server => server.serverName !== serverName),
    }
    this.notifyChange()
    return Promise.resolve()
  }

  override snapshot(): McpRuntimeSnapshot { return this.state }
  override callTool(_request: McpCallToolRequest): Promise<McpResult> {
    return Promise.resolve({ content: [] })
  }
}

const CONNECTORS: Config = {
  connectors: [
    {
      id: 'tencent-docs',
      endpoint: 'https://docs.qq.com/openapi/mcp',
      credentialRef: 'TENCENT_DOCS_MCP_TOKEN',
      serverName: 'tencent_docs',
      authorizationScheme: 'raw',
      logo: '文',
      nameZh: '腾讯文档',
      nameEn: 'Tencent Docs',
      descriptionZh: '腾讯文档',
      descriptionEn: 'Tencent Docs',
      credentialNameZh: '空间 MCP Token',
      credentialNameEn: 'Space MCP Token',
      credentialHelpUrl: 'https://docs.qq.com/open/document/mcp/get-token/',
      credentialHelpLabelZh: '获取 Token',
      credentialHelpLabelEn: 'Get Token',
    },
    {
      id: 'mail-demo',
      endpoint: 'https://mail.example.test/mcp',
      credentialRef: 'MAIL_DEMO_TOKEN',
      serverName: 'mail_demo',
      authorizationScheme: 'bearer',
      logo: '邮',
      nameZh: '邮箱示例',
      nameEn: 'Mail Demo',
      descriptionZh: '邮件工具',
      descriptionEn: 'Mail tools',
      credentialNameZh: '访问令牌',
      credentialNameEn: 'Access Token',
      credentialHelpUrl: 'https://mail.example.test/token',
      credentialHelpLabelZh: '获取令牌',
      credentialHelpLabelEn: 'Get Token',
    },
  ],
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
})

async function harness(config: Config = CONNECTORS) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(FakeMcpRuntime)
  await ctx.plugin(McpConnectorsGateway, config)
  return {
    gateway: ctx.get('mcpConnectors') as McpConnectorsGateway,
    mcp: ctx.mcp as FakeMcpRuntime,
  }
}

describe('McpConnectorsGateway', () => {
  it('projects every configured provider through one Remote catalog', async () => {
    const { gateway } = await harness()

    await expect(gateway.list()).resolves.toMatchObject({
      connectors: [
        { id: 'tencent-docs', credentialRef: 'TENCENT_DOCS_MCP_TOKEN' },
        { id: 'mail-demo', credentialRef: 'MAIL_DEMO_TOKEN' },
      ],
    })
    const publicSnapshot = await gateway.publicList()
    expect(publicSnapshot.connectors.map(connector => connector.id)).toEqual(['tencent-docs', 'mail-demo'])
    expect(JSON.stringify(publicSnapshot)).not.toContain('credentialRef')
  })

  it('routes a provider id to its endpoint, server name, and authorization scheme', async () => {
    const { gateway, mcp } = await harness()

    await expect(gateway.connect('mail-demo' as never)).resolves.toMatchObject({
      id: 'mail-demo',
      snapshot: { status: 'connected', toolCount: 1 },
    })
    expect(mcp.connects).toEqual([{
      serverName: 'mail_demo',
      transport: {
        kind: 'streamable-http',
        url: 'https://mail.example.test/mcp',
        authorization: { kind: 'credential', ref: 'MAIL_DEMO_TOKEN', scheme: 'bearer' },
      },
    }])
    await expect(gateway.disconnect('mail-demo' as never)).resolves.toMatchObject({
      id: 'mail-demo', snapshot: { status: 'disconnected' },
    })
    await expect(gateway.connect('unknown' as never)).rejects.toThrow('unknown managed MCP connector')
  })

  it('rejects duplicate identities and non-HTTPS endpoints at load time', async () => {
    const duplicate = { connectors: [CONNECTORS.connectors[0]!, {
      ...CONNECTORS.connectors[1]!,
      id: 'tencent-docs',
    }] }
    await expect(harness(duplicate)).rejects.toThrow('duplicate managed MCP connector id')

    const insecure = { connectors: [{ ...CONNECTORS.connectors[0]!, endpoint: 'http://example.test/mcp' }] }
    await expect(harness(insecure)).rejects.toThrow('must be an absolute HTTPS URL')

    for (const connector of [
      { ...CONNECTORS.connectors[0]!, id: 'Not Valid' },
      { ...CONNECTORS.connectors[0]!, serverName: 'Not Valid' },
      { ...CONNECTORS.connectors[0]!, credentialRef: 'not-valid' },
      { ...CONNECTORS.connectors[0]!, endpoint: 'not-a-url' },
      { ...CONNECTORS.connectors[0]!, credentialHelpUrl: 'https://name:secret@example.test/token' },
    ]) {
      await expect(harness({ connectors: [connector] })).rejects.toThrow()
    }

    for (const duplicateField of ['serverName', 'credentialRef'] as const) {
      await expect(harness({ connectors: [CONNECTORS.connectors[0]!, {
        ...CONNECTORS.connectors[1]!,
        [duplicateField]: CONNECTORS.connectors[0]![duplicateField],
      }] })).rejects.toThrow(`duplicate managed MCP connector ${duplicateField === 'serverName'
        ? 'server name'
        : 'credential reference'}`)
    }
  })
})
