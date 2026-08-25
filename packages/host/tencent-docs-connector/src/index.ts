/** Tencent Docs MCP connection lifecycle exposed through the Web Remote API. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  McpConnectorLifecycle,
  type McpConnectorFailures,
} from '@deepseek-ai/dsh-host-mcp-connector'
import { mcpServerName } from '@deepseek-ai/dsh-mcp'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TencentDocsConnectorEventSnapshot,
  TencentDocsConnectorSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Fixed Tencent Docs Streamable HTTP MCP endpoint. */
export const TENCENT_DOCS_MCP_ENDPOINT = 'https://docs.qq.com/openapi/mcp'

/** Credential reference used for the Tencent Docs space MCP Token. */
export const TENCENT_DOCS_MCP_CREDENTIAL_REF = credentialRef('TENCENT_DOCS_MCP_TOKEN')

/** Process-wide MCP server name reserved by this connector. */
export const TENCENT_DOCS_MCP_SERVER_NAME = mcpServerName('tencent_docs')

const FAILURES = {
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
} as const satisfies McpConnectorFailures

/** Remote service that owns the explicit Tencent Docs connection gesture. */
export class TencentDocsConnectorGateway extends TypertRemoteService {
  static inject = ['credentials', 'mcp']

  private readonly lifecycle: McpConnectorLifecycle

  constructor(ctx: Context) {
    super(ctx, 'tencentDocsConnector')
    this.lifecycle = new McpConnectorLifecycle(ctx, {
      effectName: 'tencent-docs-connector',
      endpoint: TENCENT_DOCS_MCP_ENDPOINT,
      credentialRef: TENCENT_DOCS_MCP_CREDENTIAL_REF,
      serverName: TENCENT_DOCS_MCP_SERVER_NAME,
      authorizationScheme: 'raw',
      failures: FAILURES,
    }, (snapshot) => { ctx.emit('tencent-docs-connector/change', snapshot) })
  }

  /**
   * Refresh safe credential metadata and read the complete connector state.
   * @returns the complete current connector state after the refresh.
   */
  @Remote('get')
  async get(): Promise<TencentDocsConnectorSnapshot> {
    return this.lifecycle.get()
  }

  /**
   * Read the connector fields approved for trusted non-loopback Web clients.
   * @returns a detached snapshot containing only value-free public fields.
   */
  @Remote('publicGet')
  async publicGet(): Promise<TencentDocsConnectorEventSnapshot> {
    return this.lifecycle.publicGet()
  }

  /**
   * Connect the fixed Tencent Docs endpoint through the configured credential reference.
   * @returns the complete state after the connection attempt settles.
   */
  @Remote('connect')
  async connect(): Promise<TencentDocsConnectorSnapshot> {
    return this.lifecycle.connect()
  }

  /**
   * Disconnect Tencent Docs and wait for its MCP transport generation to quiesce.
   * @returns the complete state after disconnection settles.
   */
  @Remote('disconnect')
  async disconnect(): Promise<TencentDocsConnectorSnapshot> {
    return this.lifecycle.disconnect()
  }
}

export default TencentDocsConnectorGateway
