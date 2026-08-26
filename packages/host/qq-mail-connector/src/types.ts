/** Client-safe personal QQ Mail connector state. */

/** Lifecycle phase of the process-wide personal QQ Mail connection. */
export type QqMailConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'failed'

/** Credential-free personal QQ Mail connector state. */
export interface QqMailConnectorEventSnapshot {
  /** Current credential-verification and tool-availability phase. */
  readonly status: QqMailConnectorStatus
  /** Number of personal-mail tools visible to configured presets. */
  readonly toolCount: number
  /** Stable machine-readable failure reason, when status is `failed`. */
  readonly errorCode: string | null
  /** Credential-free diagnostic safe to display to the user. */
  readonly errorMessage: string | null
  /** ISO timestamp of the latest material state change. */
  readonly updatedAt: string
}

/** Loopback-only state with value-free credential metadata. */
export interface QqMailConnectorSnapshot extends QqMailConnectorEventSnapshot {
  /** Whether both the email address and authorization code are configured. */
  readonly credentialConfigured: boolean
  /** Winning credential source, `mixed`, or absent while unconfigured. */
  readonly credentialSource: string | null
  /** Whether both credential references can be replaced or removed locally. */
  readonly credentialWritable: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The personal QQ Mail connector changed public state.
     * @mode emit
     * @param snapshot - Current credential-free state after the transition.
     */
    'qq-mail-connector/change'(snapshot: QqMailConnectorEventSnapshot): void
  }
}
