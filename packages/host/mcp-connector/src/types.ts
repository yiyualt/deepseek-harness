/** Shared Host lifecycle types for one user-managed MCP connector. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type {
  McpCredentialAuthorizationConfig,
  McpResult,
  McpServerName,
} from '@deepseek-ai/dsh-mcp'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Lifecycle phase of one process-wide user-managed MCP connection. */
export type McpConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'failed'

/** Complete connector state returned through a loopback-only Remote. */
export interface McpConnectorSnapshot {
  /** Current connection lifecycle phase. */
  readonly status: McpConnectorStatus
  /** Whether the configured credential reference currently resolves to a value. */
  readonly credentialConfigured: boolean
  /** Provider-defined credential source, or `null` while unconfigured. */
  readonly credentialSource: string | null
  /** Whether the active credential provider accepts writes for this reference. */
  readonly credentialWritable: boolean
  /** Number of MCP tools available after initialization and optional validation. */
  readonly toolCount: number
  /** Stable machine-readable failure reason, when status is `failed`. */
  readonly errorCode: string | null
  /** Credential-free diagnostic safe to display to the user. */
  readonly errorMessage: string | null
  /** ISO timestamp of the latest material state change. */
  readonly updatedAt: string
}

/** Value-free connector state safe to forward to non-loopback Web clients. */
export type McpConnectorEventSnapshot = Omit<
  McpConnectorSnapshot,
  'credentialConfigured' | 'credentialSource' | 'credentialWritable'
>

/** Stable failure fields owned by one connector integration. */
export type McpConnectorFailure = Pick<McpConnectorSnapshot, 'errorCode' | 'errorMessage'>

/** Complete fixed failure copy used by the shared lifecycle. */
export interface McpConnectorFailures {
  readonly credentialMissing: McpConnectorFailure
  readonly credentialLookup: McpConnectorFailure
  readonly authRejected: McpConnectorFailure
  readonly connectionFailed: McpConnectorFailure
  readonly connectionLost: McpConnectorFailure
  readonly disconnectFailed: McpConnectorFailure
}

/** Result classification for a provider-specific connection check. */
export type McpConnectorConnectionCheckOutcome = 'accepted' | 'auth-rejected' | 'failed'

/** Optional read-only call that verifies credentials after MCP discovery. */
export interface McpConnectorConnectionCheck {
  /** Raw MCP tool name invoked after initialization. */
  readonly toolName: string
  /** JSON arguments sent to the verification tool. */
  readonly args: Readonly<Record<string, JsonValue>>
  /** Complete call timeout in milliseconds. */
  readonly timeoutMs: number
  /**
   * Classify the credential-free result without retaining provider data.
   * @param result - detached MCP result returned by the runtime.
   * @returns whether the connection is accepted, unauthorized, or otherwise unusable.
   */
  readonly classify: (result: McpResult) => McpConnectorConnectionCheckOutcome
}

/** Fixed provider facts consumed by one shared connector lifecycle. */
export interface McpConnectorDefinition {
  /** Prefix used for lifecycle effect diagnostics. */
  readonly effectName: string
  /** Fixed Streamable HTTP MCP endpoint. */
  readonly endpoint: string
  /** Credential reference resolved only by the Host MCP provider. */
  readonly credentialRef: CredentialRef
  /** Process-wide MCP server identity reserved by this connector. */
  readonly serverName: McpServerName
  /** Authorization transformation applied after credential resolution. */
  readonly authorizationScheme: McpCredentialAuthorizationConfig['scheme']
  /** Fixed credential-free failure copy. */
  readonly failures: McpConnectorFailures
  /** Optional provider-specific read-only credential verification. */
  readonly connectionCheck?: McpConnectorConnectionCheck
}
