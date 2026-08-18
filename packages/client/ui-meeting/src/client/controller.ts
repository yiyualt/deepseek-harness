/** React-free controller for the meeting sidebar panel. */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { MeetingPresenceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser-local panel and mutation state joined with the Host snapshot. */
export interface MeetingPanelState {
  open: boolean
  draft: string
  pending: 'join' | 'leave' | null
  error: string | null
  presence: MeetingPresenceSnapshot
}

const INITIAL_PRESENCE: MeetingPresenceSnapshot = {
  status: 'idle',
  meetingUrl: null,
  provider: null,
  botName: 'DeepSeek AI 会议助手',
  errorCode: null,
  errorMessage: null,
  updatedAt: new Date(0).toISOString(),
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns the sidebar panel state and all meeting-presence Remote calls. */
export class MeetingPanelController {
  readonly store: SnapshotStore<MeetingPanelState> = createSnapshotStore({
    open: false,
    draft: '',
    pending: null,
    error: null,
    presence: INITIAL_PRESENCE,
  })

  private disposed = false

  /** @param remote - mounted application Remote namespaces. */
  constructor(private readonly remote: ClientRemote) {}

  /** Open the panel and reconcile state missed while it was closed or disconnected. */
  open(): void {
    this.store.update((state) => { state.open = true })
    void this.refresh()
  }

  /** Close the panel without stopping an active participant. */
  close(): void {
    this.store.update((state) => { state.open = false })
  }

  /** @param value - current link input. */
  setDraft(value: string): void {
    this.store.update((state) => {
      state.draft = value
      state.error = null
    })
  }

  /** Apply one Host-pushed complete presence snapshot. */
  accept(snapshot: MeetingPresenceSnapshot): void {
    if (this.disposed) return
    this.store.update((state) => {
      state.presence = snapshot
      if (snapshot.status !== 'starting' && snapshot.status !== 'leaving') state.pending = null
      if (snapshot.status === 'failed') state.error = snapshot.errorMessage
    })
  }

  /** Start the participant represented by the current draft. */
  async join(): Promise<void> {
    if (this.disposed || this.store.getSnapshot().pending !== null) return
    const url = this.store.getSnapshot().draft.trim()
    this.store.update((state) => {
      state.pending = 'join'
      state.error = null
    })
    try {
      const response = await this.remote.meetingPresence.join(url)
      if (!response.ok) throw new Error(response.error.message)
      const result = response.value
      this.accept(result.snapshot)
      if (!result.ok) this.store.update((state) => { state.error = result.message })
    } catch (error: unknown) {
      if (!this.isDisposed()) this.store.update((state) => { state.error = errorMessage(error) })
    } finally {
      if (!this.isDisposed()) this.store.update((state) => { state.pending = null })
    }
  }

  /** Stop the active participant and wait for Host-side process quiescence. */
  async leave(): Promise<void> {
    if (this.disposed || this.store.getSnapshot().pending !== null) return
    this.store.update((state) => {
      state.pending = 'leave'
      state.error = null
    })
    try {
      const response = await this.remote.meetingPresence.leave()
      if (!response.ok) throw new Error(response.error.message)
      const result = response.value
      this.accept(result.snapshot)
      if (!result.ok) this.store.update((state) => { state.error = result.message })
    } catch (error: unknown) {
      if (!this.isDisposed()) this.store.update((state) => { state.error = errorMessage(error) })
    } finally {
      if (!this.isDisposed()) this.store.update((state) => { state.pending = null })
    }
  }

  /** Ignore late Remote settlements after the plugin unloads. */
  dispose(): void {
    this.disposed = true
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private async refresh(): Promise<void> {
    try {
      const response = await this.remote.meetingPresence.get()
      if (!response.ok) throw new Error(response.error.message)
      this.accept(response.value)
    } catch (error: unknown) {
      if (!this.disposed) this.store.update((state) => { state.error = errorMessage(error) })
    }
  }
}
