/** Client-safe state exposed by the Kingsoft Docs CLI connector Remote. */

/** Lifecycle phase of the process-wide Kingsoft Docs CLI connection. */
export type KingsoftDocsConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'failed'

/** Complete connector state returned through the loopback-only Remote. */
export interface KingsoftDocsConnectorSnapshot {
  /** Current login and tool-availability phase. */
  readonly status: KingsoftDocsConnectorStatus
  /** Number of Harness tools backed by the authenticated CLI. */
  readonly toolCount: number
  /** Stable machine-readable failure reason, when status is `failed`. */
  readonly errorCode: string | null
  /** Credential-free diagnostic safe to display to the user. */
  readonly errorMessage: string | null
  /** ISO timestamp of the latest material state change. */
  readonly updatedAt: string
}

/** All Kingsoft connector state is credential-free and safe to forward. */
export type KingsoftDocsConnectorEventSnapshot = KingsoftDocsConnectorSnapshot

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The process-wide Kingsoft Docs CLI connector changed public state.
     * @mode emit
     * @param snapshot Current credential-free state after the transition.
     */
    'kingsoft-docs-connector/change'(snapshot: KingsoftDocsConnectorEventSnapshot): void
  }
}
