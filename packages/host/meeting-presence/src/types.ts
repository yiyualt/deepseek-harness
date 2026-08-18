/** JSON-safe state exposed by the meeting presence Remote. */

/** Meeting platform with a packaged browser driver. */
export type MeetingProvider = 'google-meet' | 'zoom'

/** One process-wide meeting participant phase. */
export type MeetingPresenceStatus =
  | 'idle'
  | 'starting'
  | 'waiting-admission'
  | 'joined'
  | 'leaving'
  | 'left'
  | 'failed'

/** Current participant state returned to every Web client. */
export interface MeetingPresenceSnapshot {
  /** Current lifecycle phase. */
  status: MeetingPresenceStatus
  /** Canonical Google Meet URL while one request exists. */
  meetingUrl: string | null
  /** Platform selected from the validated meeting URL. */
  provider: MeetingProvider | null
  /** Participant name shown inside Google Meet. */
  botName: string
  /** Stable machine-readable failure reason, when status is `failed`. */
  errorCode: string | null
  /** Bounded diagnostic safe to display to the user. */
  errorMessage: string | null
  /** ISO timestamp of the latest state transition. */
  updatedAt: string
}

/** Result of a join or leave gesture. */
export type MeetingPresenceMutation =
  | { ok: true; snapshot: MeetingPresenceSnapshot }
  | { ok: false; code: string; message: string; snapshot: MeetingPresenceSnapshot }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A process-wide meeting participant changed state.
     * @mode parallel
     * @param snapshot Current complete state after the transition.
     */
    'meeting-presence/change'(snapshot: MeetingPresenceSnapshot): void
  }
}
