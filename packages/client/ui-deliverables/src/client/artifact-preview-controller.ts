/** Artifact interception with Host preparation for the preview panel. */

import type {
  GenOfficeDocxBlock, GenOfficeXlsxEdit, IApiClient, SessionId,
} from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFilePreview, ChatFilePreviewRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  initialArtifactPreviewState, type ArtifactPreviewState, type ArtifactPreviewTab,
} from './artifact-preview-store.ts'

const HTML_EXTENSION = /\.(?:html?|xhtml)$/i
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i
const OFFICE_EXTENSION = /\.(?:doc|docx|txt|xls|xlsx|csv|ppt|pptx|pdf)$/i

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function clearGenOfficeXlsx(tab: ArtifactPreviewTab): void {
  delete tab.genOfficeXlsxGrantId
  delete tab.genOfficeXlsxSheets
  delete tab.genOfficeXlsxEdits
  delete tab.genOfficeXlsxRevision
  delete tab.genOfficeXlsxSaving
  delete tab.genOfficeXlsxConflict
  delete tab.genOfficeXlsxError
}

function webUrl(rawUrl: string): URL | undefined {
  const value = rawUrl.trim()
  if (value === '') return undefined
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
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
   * Navigate an empty tab directly to an HTTP(S) page.
   * @param sessionId Session that owns the tab.
   * @param id Empty tab id.
   * @param rawUrl User-entered address; HTTPS is assumed when the scheme is omitted.
   * @returns Whether the address and tab were accepted.
   */
  openUrl(sessionId: SessionId, id: string, rawUrl: string): boolean {
    const url = webUrl(rawUrl)
    if (url === undefined) return false
    const store = this.sourceFor(sessionId)
    if (!store.getSnapshot().tabs.some(tab => tab.id === id && tab.status === 'idle')) return false
    store.update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.status === 'idle')
      if (tab === undefined) return
      tab.status = 'ready'
      tab.kind = 'html'
      tab.name = url.host
      tab.path = url.href
      tab.url = url.href
      delete tab.error
      state.activeId = id
    })
    this.layout.openDetails('artifact-preview', 'wide')
    return true
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

  /**
   * Replace one Markdown tab's draft.
   * @param sessionId Session that owns the tab.
   * @param id Markdown tab id.
   * @param content Complete Markdown source from the editor.
   */
  editMarkdown(sessionId: SessionId, id: string, content: string): void {
    this.sourceFor(sessionId).update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'markdown')
      if (tab === undefined) return
      tab.markdownContent = content
      delete tab.markdownConflict
      delete tab.markdownError
    })
  }

  /**
   * Save one Markdown draft through its Host grant.
   * @param sessionId Session that owns the tab.
   * @param id Markdown tab id.
   */
  async saveMarkdown(sessionId: SessionId, id: string): Promise<void> {
    const store = this.sourceFor(sessionId)
    const tab = store.getSnapshot().tabs.find(candidate => candidate.id === id && candidate.kind === 'markdown')
    if (
      tab?.markdownGrantId === undefined
      || tab.markdownContent === undefined
      || tab.markdownRevision === undefined
      || tab.markdownSaving === true
    ) return
    const content = tab.markdownContent
    const revision = tab.markdownRevision
    store.update((state) => {
      const target = state.tabs.find(candidate => candidate.id === id)
      if (target === undefined) return
      target.markdownSaving = true
      delete target.markdownConflict
      delete target.markdownError
    })
    try {
      const response = await this.api.host.saveMarkdownArtifact({
        grantId: tab.markdownGrantId,
        content,
        revision,
      })
      const result = response.result
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'markdown')
        if (target === undefined) return
        target.markdownSaving = false
        if (result.ok) {
          target.markdownSavedContent = content
          target.markdownRevision = result.value.revision
          delete target.markdownConflict
          delete target.markdownError
        } else {
          target.markdownConflict = result.error.code === 'artifact-preview-conflict'
          target.markdownError = result.error.message
        }
      })
    } catch (error: unknown) {
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'markdown')
        if (target === undefined) return
        target.markdownSaving = false
        target.markdownError = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Replace one DOCX rich-text draft.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice DOCX tab id.
   * @param blocks Complete browser-safe block values.
   */
  editGenOfficeDocx(sessionId: SessionId, id: string, blocks: GenOfficeDocxBlock[]): void {
    this.sourceFor(sessionId).update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-docx')
      if (tab === undefined) return
      tab.genOfficeBlocks = structuredClone(blocks)
      delete tab.genOfficeConflict
      delete tab.genOfficeError
    })
  }

  /**
   * Save one local DOCX draft through its GenOffice Host grant.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice DOCX tab id.
   */
  async saveGenOfficeDocx(sessionId: SessionId, id: string): Promise<void> {
    const store = this.sourceFor(sessionId)
    const tab = store.getSnapshot().tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-docx')
    if (
      tab?.genOfficeGrantId === undefined
      || tab.genOfficeBlocks === undefined
      || tab.genOfficeRevision === undefined
      || tab.genOfficeSaving === true
    ) return
    const revision = tab.genOfficeRevision
    const edits = tab.genOfficeBlocks
      .filter(block => block.editable)
      .map(block => ({
        docxIndex: block.docxIndex,
        runs: block.runs ?? [{ text: block.text }],
        ...(block.align === undefined ? {} : { align: block.align }),
      }))
    store.update((state) => {
      const target = state.tabs.find(candidate => candidate.id === id)
      if (target === undefined) return
      target.genOfficeSaving = true
      delete target.genOfficeConflict
      delete target.genOfficeError
    })
    try {
      const response = await this.api.host.saveGenOfficeDocxArtifact({
        grantId: tab.genOfficeGrantId,
        edits,
        revision,
      })
      const result = response.result
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-docx')
        if (target === undefined) return
        target.genOfficeSaving = false
        if (result.ok) {
          target.genOfficeBlocks = structuredClone(result.value.blocks)
          target.genOfficeSavedBlocks = structuredClone(result.value.blocks)
          target.genOfficeRevision = result.value.revision
          delete target.genOfficeConflict
          delete target.genOfficeError
        } else {
          target.genOfficeConflict = result.error.code === 'artifact-preview-conflict'
          target.genOfficeError = result.error.message
        }
      })
    } catch (error: unknown) {
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-docx')
        if (target === undefined) return
        target.genOfficeSaving = false
        target.genOfficeError = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Replace one XLSX cell-edit journal.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice XLSX tab id.
   * @param edits Complete pending cell deltas from the embedded grid.
   */
  editGenOfficeXlsx(sessionId: SessionId, id: string, edits: GenOfficeXlsxEdit[]): void {
    this.sourceFor(sessionId).update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-xlsx')
      if (tab === undefined) return
      tab.genOfficeXlsxEdits = structuredClone(edits)
      delete tab.genOfficeXlsxConflict
      delete tab.genOfficeXlsxError
    })
  }

  /**
   * Save one local XLSX edit journal through its GenOffice Host grant.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice XLSX tab id.
   */
  async saveGenOfficeXlsx(sessionId: SessionId, id: string): Promise<void> {
    const store = this.sourceFor(sessionId)
    const tab = store.getSnapshot().tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-xlsx')
    if (
      tab?.genOfficeXlsxGrantId === undefined
      || tab.genOfficeXlsxRevision === undefined
      || tab.genOfficeXlsxEdits === undefined
      || tab.genOfficeXlsxEdits.length === 0
      || tab.genOfficeXlsxSaving === true
    ) return
    const edits = structuredClone(tab.genOfficeXlsxEdits)
    const revision = tab.genOfficeXlsxRevision
    store.update((state) => {
      const target = state.tabs.find(candidate => candidate.id === id)
      if (target === undefined) return
      target.genOfficeXlsxSaving = true
      delete target.genOfficeXlsxConflict
      delete target.genOfficeXlsxError
    })
    try {
      const response = await this.api.host.saveGenOfficeXlsxArtifact({
        grantId: tab.genOfficeXlsxGrantId,
        edits,
        revision,
      })
      const result = response.result
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-xlsx')
        if (target === undefined) return
        target.genOfficeXlsxSaving = false
        if (result.ok) {
          target.genOfficeXlsxRevision = result.value.revision
          target.genOfficeXlsxEdits = []
          delete target.genOfficeXlsxConflict
          delete target.genOfficeXlsxError
        } else {
          target.genOfficeXlsxConflict = result.error.code === 'artifact-preview-conflict'
          target.genOfficeXlsxError = result.error.message
        }
      })
    } catch (error: unknown) {
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-xlsx')
        if (target === undefined) return
        target.genOfficeXlsxSaving = false
        target.genOfficeXlsxError = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Claim supported paths, add or activate their tab, and prepare its renderer. */
  async open(request: ChatFilePreviewRequest): Promise<boolean> {
    if (
      !HTML_EXTENSION.test(request.path)
      && !MARKDOWN_EXTENSION.test(request.path)
      && !OFFICE_EXTENSION.test(request.path)
    ) return false
    const store = this.sourceFor(request.sessionId)
    const existing = store.getSnapshot().tabs.find(tab => tab.path === request.path)
    if (existing !== undefined && existing.kind !== 'office' && existing.kind !== 'tencent-docs') {
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
          clearGenOfficeXlsx(tab)
          if (prepared.kind === 'html') {
            tab.url = prepared.url
            delete tab.markdownGrantId
            delete tab.markdownContent
            delete tab.markdownSavedContent
            delete tab.markdownRevision
            delete tab.officeApiUrl
            delete tab.officeConfig
            delete tab.tencentDocsScriptUrl
            delete tab.tencentDocsConfig
            delete tab.genOfficeGrantId
            delete tab.genOfficeBlocks
            delete tab.genOfficeSavedBlocks
            delete tab.genOfficeRevision
          } else if (prepared.kind === 'markdown') {
            tab.markdownGrantId = prepared.grantId
            tab.markdownContent = prepared.content
            tab.markdownSavedContent = prepared.content
            tab.markdownRevision = prepared.revision
            tab.markdownSaving = false
            delete tab.markdownConflict
            delete tab.markdownError
            delete tab.url
            delete tab.officeApiUrl
            delete tab.officeConfig
            delete tab.tencentDocsScriptUrl
            delete tab.tencentDocsConfig
            delete tab.genOfficeGrantId
            delete tab.genOfficeBlocks
            delete tab.genOfficeSavedBlocks
            delete tab.genOfficeRevision
          } else if (prepared.kind === 'genoffice-docx') {
            tab.genOfficeGrantId = prepared.grantId
            tab.genOfficeBlocks = structuredClone(prepared.blocks)
            tab.genOfficeSavedBlocks = structuredClone(prepared.blocks)
            tab.genOfficeRevision = prepared.revision
            tab.genOfficeSaving = false
            delete tab.genOfficeConflict
            delete tab.genOfficeError
            delete tab.url
            delete tab.markdownGrantId
            delete tab.markdownContent
            delete tab.markdownSavedContent
            delete tab.markdownRevision
            delete tab.officeApiUrl
            delete tab.officeConfig
            delete tab.tencentDocsScriptUrl
            delete tab.tencentDocsConfig
          } else if (prepared.kind === 'genoffice-xlsx') {
            tab.genOfficeXlsxGrantId = prepared.grantId
            tab.genOfficeXlsxSheets = structuredClone(prepared.sheets)
            tab.genOfficeXlsxEdits = []
            tab.genOfficeXlsxRevision = prepared.revision
            tab.genOfficeXlsxSaving = false
            delete tab.url
            delete tab.markdownGrantId
            delete tab.markdownContent
            delete tab.markdownSavedContent
            delete tab.markdownRevision
            delete tab.officeApiUrl
            delete tab.officeConfig
            delete tab.tencentDocsScriptUrl
            delete tab.tencentDocsConfig
            delete tab.genOfficeGrantId
            delete tab.genOfficeBlocks
            delete tab.genOfficeSavedBlocks
            delete tab.genOfficeRevision
          } else if (prepared.kind === 'office') {
            tab.officeApiUrl = prepared.apiUrl
            tab.officeConfig = prepared.config
            delete tab.url
            delete tab.markdownGrantId
            delete tab.markdownContent
            delete tab.markdownSavedContent
            delete tab.markdownRevision
            delete tab.tencentDocsScriptUrl
            delete tab.tencentDocsConfig
            delete tab.genOfficeGrantId
            delete tab.genOfficeBlocks
            delete tab.genOfficeSavedBlocks
            delete tab.genOfficeRevision
          } else {
            tab.tencentDocsScriptUrl = prepared.scriptUrl
            tab.tencentDocsConfig = prepared.config
            delete tab.url
            delete tab.markdownGrantId
            delete tab.markdownContent
            delete tab.markdownSavedContent
            delete tab.markdownRevision
            delete tab.officeApiUrl
            delete tab.officeConfig
            delete tab.genOfficeGrantId
            delete tab.genOfficeBlocks
            delete tab.genOfficeSavedBlocks
            delete tab.genOfficeRevision
          }
          delete tab.error
        })
      } else {
        if (result.error.code === 'artifact-preview-unsupported') {
          store.update((state) => {
            const tab = state.tabs.find(candidate => candidate.requestId === requestId)
            if (tab === undefined) return
            if (blank !== undefined) {
              tab.status = 'idle'
              tab.requestId = 0
              tab.path = ''
              tab.name = ''
              delete tab.kind
              state.activeId = tab.id
              return
            }
            const at = state.tabs.indexOf(tab)
            state.tabs.splice(at, 1)
            if (state.activeId === id) delete state.activeId
          })
          if (store.getSnapshot().tabs.length === 0) this.layout.closeDetails()
          return false
        }
        const message = result.error.message
        store.update((state) => {
          const tab = state.tabs.find(candidate => candidate.requestId === requestId)
          if (tab === undefined) return
          tab.status = 'error'
          tab.error = message
          delete tab.url
          delete tab.officeApiUrl
          delete tab.officeConfig
          delete tab.tencentDocsScriptUrl
          delete tab.tencentDocsConfig
          delete tab.markdownGrantId
          delete tab.markdownContent
          delete tab.markdownSavedContent
          delete tab.markdownRevision
          delete tab.genOfficeGrantId
          delete tab.genOfficeBlocks
          delete tab.genOfficeSavedBlocks
          delete tab.genOfficeRevision
          clearGenOfficeXlsx(tab)
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
        delete tab.tencentDocsScriptUrl
        delete tab.tencentDocsConfig
        delete tab.markdownGrantId
        delete tab.markdownContent
        delete tab.markdownSavedContent
        delete tab.markdownRevision
        delete tab.genOfficeGrantId
        delete tab.genOfficeBlocks
        delete tab.genOfficeSavedBlocks
        delete tab.genOfficeRevision
        clearGenOfficeXlsx(tab)
      })
    }
    return true
  }
}
