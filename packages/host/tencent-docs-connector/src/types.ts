/** Client-safe state exposed by the Tencent Docs connector Remote. */

import type {
  McpConnectorEventSnapshot,
  McpConnectorSnapshot,
  McpConnectorStatus,
} from '@deepseek-ai/dsh-host-mcp-connector/types'

/** Lifecycle phase of the process-wide Tencent Docs MCP connection. */
export type TencentDocsConnectorStatus = McpConnectorStatus

/** Complete connector state returned through the loopback-only Remote. */
export type TencentDocsConnectorSnapshot = McpConnectorSnapshot

/** Value-free connector state safe to forward to non-loopback Web clients. */
export type TencentDocsConnectorEventSnapshot = McpConnectorEventSnapshot

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The process-wide Tencent Docs connector changed public state.
     * @mode emit
     * @param snapshot Current value-free state after the transition.
     */
    'tencent-docs-connector/change'(snapshot: TencentDocsConnectorEventSnapshot): void
  }
}
