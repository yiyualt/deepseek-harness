/** HTML and DOCX interception with Host preparation for the preview panel. */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFilePreview, ChatFilePreviewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  initialArtifactPreviewState, type ArtifactPreviewState,
} from './artifact-preview-store.ts'

const HTML_EXTENSION = /\.(?:html?|xhtml)$/i
const OFFICE_EXTENSION = /\.docx$/i

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

  /**
   * Activate one retained tab when it exists.
   * @param sessionId Session that owns the tab.
   * @param id Retained tab id.
   */
  activate(sessionId: SessionId, id: string): void {
    this.sourceFor(sessionId).update((state) => {
      if (state.tabs.some(tab => tab.id === id)) state.activeId = id
    })
  }

  /**
   * Add and activate an empty preview tab.
   * @param sessionId Session that owns the new tab.
   */
  newTab(sessionId: SessionId): void {
    const id = `blank-${String(++this.#tabId)}`
    this.sourceFor(sessionId).update((state) => {
      state.tabs.push({ id, status: 'idle', requestId: 0, name: '', path: '' })
      state.activeId = id
    })
    this.layout.openDetails('artifact-preview', 'wide')
  }

  /**
   * Close one retained tab and close the right column when it was the last tab.
   * @param sessionId Session that owns the tab.
   * @param id Retained tab id.
   */
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

  /** Claim supported paths, add or activate their tab, and prepare its renderer. */
  async open(request: ChatFilePreviewRequest): Promise<boolean> {
    if (!HTML_EXTENSION.test(request.path) && !OFFICE_EXTENSION.test(request.path)) return false
    const store = this.sourceFor(request.sessionId)
    const existing = store.getSnapshot().tabs.find(tab => tab.path === request.path)
    if (existing !== undefined && existing.kind !== 'office') {
      this.activate(request.sessionId, existing.id)
      this.layout.openDetails('artifact-preview', 'wide')
      return true
    }
    const requestId = ++this.#requestId
    const before = store.getSnapshot()
    const blank = before.tabs.find(tab => (
      tab.id === before.activeId && tab.status === 'idle' && tab.path === ''
    ))
    const id = existing?.id ?? blank?.id ?? `file-${String(++this.#tabId)}`
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
        const prepared = result.value
        store.update((state) => {
          const tab = state.tabs.find(candidate => candidate.requestId === requestId)
          if (tab === undefined) return
          tab.status = 'ready'
          tab.name = prepared.name
          tab.kind = prepared.kind
          if (prepared.kind === 'html') {
            tab.url = prepared.url
            delete tab.officeApiUrl
            delete tab.officeConfig
          } else {
            tab.officeApiUrl = prepared.apiUrl
            tab.officeConfig = prepared.config
            delete tab.url
          }
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
          delete tab.officeApiUrl
          delete tab.officeConfig
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
        delete tab.officeApiUrl
        delete tab.officeConfig
      })
    }
    return true
  }
}
