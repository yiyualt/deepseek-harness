/** Kingsoft Docs MCP connection lifecycle exposed through the Web Remote API. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  McpConnectorLifecycle,
  type McpConnectorConnectionCheckOutcome,
  type McpConnectorFailures,
} from '@deepseek-ai/dsh-host-mcp-connector'
import { mcpServerName, type McpResult } from '@deepseek-ai/dsh-mcp'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  KingsoftDocsConnectorEventSnapshot,
  KingsoftDocsConnectorSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Fixed Kingsoft Docs Streamable HTTP MCP endpoint. */
export const KINGSOFT_DOCS_MCP_ENDPOINT = 'https://mcp-center.wps.cn/skill_hub/mcp'

/** Credential reference used for the Kingsoft Docs personal Token. */
export const KINGSOFT_DOCS_MCP_CREDENTIAL_REF = credentialRef('KINGSOFT_DOCS_TOKEN')

/** Process-wide MCP server name reserved by this connector. */
export const KINGSOFT_DOCS_MCP_SERVER_NAME = mcpServerName('kingsoft_docs')

/** Connection verification budget. */
export interface Config {
  /** Maximum time for the read-only credential verification call. */
  validationTimeoutMs: number
}

/** Validated Kingsoft Docs connector configuration. */
export const Config: Schema<Config> = Schema.object({
  validationTimeoutMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
})

const FAILURES = {
  credentialMissing: {
    errorCode: 'CREDENTIAL_MISSING',
    errorMessage: 'Save a Kingsoft Docs Token before connecting.',
  },
  credentialLookup: {
    errorCode: 'CREDENTIAL_LOOKUP_FAILED',
    errorMessage: 'Unable to read the Kingsoft Docs Token configuration.',
  },
  authRejected: {
    errorCode: 'AUTH_REJECTED',
    errorMessage: 'Kingsoft Docs rejected the current Token. Update it and try again.',
  },
  connectionFailed: {
    errorCode: 'CONNECTION_FAILED',
    errorMessage: 'Unable to connect to Kingsoft Docs. Try again later.',
  },
  connectionLost: {
    errorCode: 'CONNECTION_LOST',
    errorMessage: 'The Kingsoft Docs connection was lost. Try again.',
  },
  disconnectFailed: {
    errorCode: 'DISCONNECT_FAILED',
    errorMessage: 'Unable to disconnect from Kingsoft Docs. Try again.',
  },
} as const satisfies McpConnectorFailures

function codeFrom(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>).code
}

function connectionCode(result: McpResult): unknown {
  const structured = codeFrom(result.structuredContent)
  if (structured !== undefined) return structured
  for (const block of result.content) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue
    const text = (block as Record<string, unknown>).text
    if (typeof text !== 'string') continue
    try {
      const code = codeFrom(JSON.parse(text) as unknown)
      if (code !== undefined) return code
    } catch {
      // Only JSON text can carry the documented Kingsoft result code.
    }
  }
  return undefined
}

function classifyConnection(result: McpResult): McpConnectorConnectionCheckOutcome {
  const code = connectionCode(result)
  if (code === 0 || code === '0') return 'accepted'
  if (code === 400006 || code === '400006') return 'auth-rejected'
  return 'failed'
}

/** Remote service that owns the explicit Kingsoft Docs connection gesture. */
export class KingsoftDocsConnectorGateway extends TypertRemoteService {
  static inject = ['credentials', 'mcp']
  static Config: Schema<Config> = Config

  private readonly lifecycle: McpConnectorLifecycle

  /**
   * @param ctx - Host context carrying credentials and the dynamic MCP runtime.
   * @param config - validated connection verification budget.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'kingsoftDocsConnector')
    this.lifecycle = new McpConnectorLifecycle(ctx, {
      effectName: 'kingsoft-docs-connector',
      endpoint: KINGSOFT_DOCS_MCP_ENDPOINT,
      credentialRef: KINGSOFT_DOCS_MCP_CREDENTIAL_REF,
      serverName: KINGSOFT_DOCS_MCP_SERVER_NAME,
      authorizationScheme: 'bearer',
      failures: FAILURES,
      connectionCheck: {
        toolName: 'list_my_files',
        args: { page_size: 1 },
        timeoutMs: config.validationTimeoutMs,
        classify: classifyConnection,
      },
    }, (snapshot) => { ctx.emit('kingsoft-docs-connector/change', snapshot) })
  }

  /**
   * Refresh safe credential metadata and read the complete connector state.
   * @returns the complete current connector state after the refresh.
   */
  @Remote('get')
  async get(): Promise<KingsoftDocsConnectorSnapshot> {
    return this.lifecycle.get()
  }

  /**
   * Read the connector fields approved for trusted non-loopback Web clients.
   * @returns a detached snapshot containing only value-free public fields.
   */
  @Remote('publicGet')
  async publicGet(): Promise<KingsoftDocsConnectorEventSnapshot> {
    return this.lifecycle.publicGet()
  }

  /**
   * Connect the fixed Kingsoft Docs endpoint through the configured credential reference.
   * @returns the complete state after discovery and read-only authentication verification settle.
   */
  @Remote('connect')
  async connect(): Promise<KingsoftDocsConnectorSnapshot> {
    return this.lifecycle.connect()
  }

  /**
   * Disconnect Kingsoft Docs and wait for its MCP transport generation to quiesce.
   * @returns the complete state after disconnection settles.
   */
  @Remote('disconnect')
  async disconnect(): Promise<KingsoftDocsConnectorSnapshot> {
    return this.lifecycle.disconnect()
  }
}

export default KingsoftDocsConnectorGateway
