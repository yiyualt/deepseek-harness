/** Shared Host lifecycle types for one user-managed MCP connector. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  McpCredentialAuthorizationConfig,
  McpServerName,
} from '@deepseek-ai/dsh-mcp'

/** Stable deployment-owned identity of one managed MCP connector. */
export type McpConnectorId = Branded<'McpConnectorId'>

/**
 * Construct a managed MCP connector identity after configuration validation.
 * @param value - validated deployment-owned identifier.
 * @returns branded connector identifier.
 */
export const mcpConnectorId = (value: string): McpConnectorId => value as McpConnectorId

/** Localized product text sent to the connector panel. */
export interface McpConnectorLocalizedText {
  /** Simplified Chinese copy. */
  readonly zh: string
  /** English copy. */
  readonly en: string
}

/** Safe presentation metadata for one managed MCP connector card. */
export interface McpConnectorPresentation {
  /** Short text mark rendered in the connector avatar. */
  readonly logo: string
  /** Product name. */
  readonly name: McpConnectorLocalizedText
  /** Product capability summary. */
  readonly description: McpConnectorLocalizedText
  /** Name of the credential the user supplies. */
  readonly credentialName: McpConnectorLocalizedText
  /** Provider-owned credential setup page. */
  readonly credentialHelpUrl: string
  /** Link copy for the credential setup page. */
  readonly credentialHelpLabel: McpConnectorLocalizedText
}

/** Public identity and presentation fields for one configured MCP connector. */
export interface McpConnectorDescriptor {
  /** Stable connector identity used by Remote mutations. */
  readonly id: McpConnectorId
  /** Safe product metadata rendered by the browser. */
  readonly presentation: McpConnectorPresentation
}

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
}

/** Full loopback view of one configured connector. */
export interface McpConnectorView extends McpConnectorDescriptor {
  /** Host-owned lifecycle and credential metadata. */
  readonly snapshot: McpConnectorSnapshot
  /** Credential reference accepted by the loopback credential API. */
  readonly credentialRef: CredentialRef
}

/** Value-free view safe for trusted non-loopback clients. */
export interface McpConnectorPublicView extends McpConnectorDescriptor {
  /** Public lifecycle fields without credential metadata. */
  readonly snapshot: McpConnectorEventSnapshot
}

/** Full catalog returned only through the loopback Remote. */
export interface McpConnectorsSnapshot {
  /** Connectors in deployment order. */
  readonly connectors: readonly McpConnectorView[]
}

/** Public connector catalog forwarded to trusted Web clients. */
export interface McpConnectorsPublicSnapshot {
  /** Value-free connectors in deployment order. */
  readonly connectors: readonly McpConnectorPublicView[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The public managed-MCP connector catalog changed.
     * @mode emit
     * @param snapshot Current value-free catalog after the transition.
     */
    'mcp-connectors/change'(snapshot: McpConnectorsPublicSnapshot): void
  }
}
