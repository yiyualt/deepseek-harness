/** Client-safe state exposed by the Kingsoft Docs connector Remote. */

import type {
  McpConnectorEventSnapshot,
  McpConnectorSnapshot,
  McpConnectorStatus,
} from '@deepseek-ai/dsh-host-mcp-connector/types'

/** Lifecycle phase of the process-wide Kingsoft Docs MCP connection. */
export type KingsoftDocsConnectorStatus = McpConnectorStatus

/** Complete connector state returned through the loopback-only Remote. */
export type KingsoftDocsConnectorSnapshot = McpConnectorSnapshot

/** Value-free connector state safe to forward to non-loopback Web clients. */
export type KingsoftDocsConnectorEventSnapshot = McpConnectorEventSnapshot

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The process-wide Kingsoft Docs connector changed public state.
     * @mode emit
     * @param snapshot Current value-free state after the transition.
     */
    'kingsoft-docs-connector/change'(snapshot: KingsoftDocsConnectorEventSnapshot): void
  }
}
