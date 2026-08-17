/** HTML file interception and Host grant preparation for the preview panel. */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFilePreview, ChatFilePreviewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  initialArtifactPreviewState, type ArtifactPreviewState,
} from './artifact-preview-store.ts'

const HTML_EXTENSION = /\.(?:html?|xhtml)$/i

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** Coordinates the optional file-preview interception with session stores. */
export class ArtifactPreviewController implements ChatFilePreview {
  readonly #stores = new Map<SessionId, SnapshotStore<ArtifactPreviewState>>()
  #requestId = 0
  #tabId = 0

  constructor(
    private readonly api: IApiClient,
    private readonly layout: ILayout,
  ) {}

  /**
   * Observable preview state for one session.
   *
   * @param sessionId Session that owns the preview panel state.
   * @returns The stable store retained for that session.
   */
  sourceFor(sessionId: SessionId): SnapshotStore<ArtifactPreviewState> {
    let store = this.#stores.get(sessionId)
    if (store !== undefined) return store
    store = createSnapshotStore(initialArtifactPreviewState())
    this.#stores.set(sessionId, store)
    return store
  }

  /** Activate one retained tab when it exists. */
  activate(sessionId: SessionId, id: string): void {
    this.sourceFor(sessionId).update((state) => {
      if (state.tabs.some(tab => tab.id === id)) state.activeId = id
    })
  }

  /** Add and activate an empty preview tab. */
  newTab(sessionId: SessionId): void {
    const id = `blank-${String(++this.#tabId)}`
    this.sourceFor(sessionId).update((state) => {
      state.tabs.push({ id, status: 'idle', requestId: 0, name: '', path: '' })
      state.activeId = id
    })
    this.layout.openDetails('artifact-preview', 'wide')
  }

  /** Close one retained tab and close the right column when it was the last tab. */
  close(sessionId: SessionId, id: string): void {
    const store = this.sourceFor(sessionId)
    store.update((state) => {
      const at = state.tabs.findIndex(tab => tab.id === id)
      if (at === -1) return
      state.tabs.splice(at, 1)
      if (state.activeId !== id) return
      const next = state.tabs[Math.max(0, at - 1)]
      if (next === undefined) delete state.activeId
      else state.activeId = next.id
    })
    if (store.getSnapshot().tabs.length === 0) this.layout.closeDetails()
  }

  /** Claim HTML paths, add or activate their tab, and prepare an opaque Host grant. */
  async open(request: ChatFilePreviewRequest): Promise<boolean> {
    if (!HTML_EXTENSION.test(request.path)) return false
    const store = this.sourceFor(request.sessionId)
    const existing = store.getSnapshot().tabs.find(tab => tab.path === request.path)
    if (existing !== undefined) {
      this.activate(request.sessionId, existing.id)
      this.layout.openDetails('artifact-preview', 'wide')
      return true
    }
    const requestId = ++this.#requestId
    const before = store.getSnapshot()
    const blank = before.tabs.find(tab => (
      tab.id === before.activeId && tab.status === 'idle' && tab.path === ''
    ))
    const id = blank?.id ?? `file-${String(++this.#tabId)}`
    store.update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id)
      if (tab === undefined) {
        state.tabs.push({
          id, status: 'loading', requestId, path: request.path, name: basename(request.path),
        })
      } else {
        tab.status = 'loading'
        tab.requestId = requestId
        tab.path = request.path
        tab.name = basename(request.path)
      }
      state.activeId = id
    })
    this.layout.openDetails('artifact-preview', 'wide')
    try {
      const response = await this.api.host.prepareArtifactPreview({ path: request.path })
      if (!store.getSnapshot().tabs.some(tab => tab.requestId === requestId)) return true
      const result = response.result
      if (result.ok) {
        const { name, url } = result.value
        store.update((state) => {
          const tab = state.tabs.find(candidate => candidate.requestId === requestId)
          if (tab === undefined) return
          tab.status = 'ready'
          tab.name = name
          tab.url = url
          delete tab.error
        })
      } else {
        const message = result.error.message
        store.update((state) => {
          const tab = state.tabs.find(candidate => candidate.requestId === requestId)
          if (tab === undefined) return
          tab.status = 'error'
          tab.error = message
          delete tab.url
        })
      }
    } catch (error: unknown) {
      if (!store.getSnapshot().tabs.some(tab => tab.requestId === requestId)) return true
      store.update((state) => {
        const tab = state.tabs.find(candidate => candidate.requestId === requestId)
        if (tab === undefined) return
        tab.status = 'error'
        tab.error = error instanceof Error ? error.message : String(error)
        delete tab.url
      })
    }
    return true
  }
}
