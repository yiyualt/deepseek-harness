/** Client-safe state exposed by the Tencent Docs connector Remote. */

/** Lifecycle phase of the process-wide Tencent Docs MCP connection. */
export type TencentDocsConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'failed'

/** Complete connector state returned through the loopback-only Remote. */
export interface TencentDocsConnectorSnapshot {
  /** Current connection lifecycle phase. */
  readonly status: TencentDocsConnectorStatus
  /** Whether the configured credential reference currently resolves to a value. */
  readonly credentialConfigured: boolean
  /** Provider-defined credential source, or `null` while unconfigured. */
  readonly credentialSource: string | null
  /** Whether the active credential provider accepts writes for this reference. */
  readonly credentialWritable: boolean
  /** Number of Tencent Docs MCP tools available after initialization. */
  readonly toolCount: number
  /** Stable machine-readable failure reason, when status is `failed`. */
  readonly errorCode: string | null
  /** Credential-free diagnostic safe to display to the user. */
  readonly errorMessage: string | null
  /** ISO timestamp of the latest material state change. */
  readonly updatedAt: string
}

/** Value-free connector state safe to forward to non-loopback Web clients. */
export type TencentDocsConnectorEventSnapshot = Omit<
  TencentDocsConnectorSnapshot,
  'credentialConfigured' | 'credentialSource' | 'credentialWritable'
>

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
