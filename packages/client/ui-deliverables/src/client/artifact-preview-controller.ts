/** Artifact interception with Host preparation for the preview panel. */

import type {
  GenOfficeDocxBlock, GenOfficePptxTextStyle, GenOfficeXlsxEdit, IApiClient, SessionId,
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

function clearGenOfficePptx(tab: ArtifactPreviewTab): void {
  delete tab.genOfficePptxGrantId
  delete tab.genOfficePptxSlides
  delete tab.genOfficePptxSavedSlides
  delete tab.genOfficePptxRevision
  delete tab.genOfficePptxSaving
  delete tab.genOfficePptxConflict
  delete tab.genOfficePptxError
}

function clearHtmlEditing(tab: ArtifactPreviewTab): void {
  delete tab.htmlGrantId
  delete tab.htmlContent
  delete tab.htmlSavedContent
  delete tab.htmlRevision
  delete tab.htmlSaving
  delete tab.htmlConflict
  delete tab.htmlError
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
   * Replace one local HTML tab's draft source.
   * @param sessionId Session that owns the tab.
   * @param id HTML tab id.
   * @param content Complete HTML source from the visual or source editor.
   */
  editHtml(sessionId: SessionId, id: string, content: string): void {
    this.sourceFor(sessionId).update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'html')
      if (tab?.htmlGrantId === undefined) return
      tab.htmlContent = content
      delete tab.htmlConflict
      delete tab.htmlError
    })
  }

  /**
   * Save one local HTML draft through its Host grant.
   * @param sessionId Session that owns the tab.
   * @param id HTML tab id.
   */
  async saveHtml(sessionId: SessionId, id: string): Promise<void> {
    const store = this.sourceFor(sessionId)
    const tab = store.getSnapshot().tabs.find(candidate => candidate.id === id && candidate.kind === 'html')
    if (
      tab?.htmlGrantId === undefined
      || tab.htmlContent === undefined
      || tab.htmlRevision === undefined
      || tab.htmlSaving === true
    ) return
    const content = tab.htmlContent
    const revision = tab.htmlRevision
    store.update((state) => {
      const target = state.tabs.find(candidate => candidate.id === id)
      if (target === undefined) return
      target.htmlSaving = true
      delete target.htmlConflict
      delete target.htmlError
    })
    try {
      const response = await this.api.host.saveHtmlArtifact({
        grantId: tab.htmlGrantId, content, revision,
      })
      const result = response.result
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'html')
        if (target === undefined) return
        target.htmlSaving = false
        if (result.ok) {
          target.htmlSavedContent = content
          target.htmlRevision = result.value.revision
          delete target.htmlConflict
          delete target.htmlError
        } else {
          target.htmlConflict = result.error.code === 'artifact-preview-conflict'
          target.htmlError = result.error.message
        }
      })
    } catch (error: unknown) {
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'html')
        if (target === undefined) return
        target.htmlSaving = false
        target.htmlError = error instanceof Error ? error.message : String(error)
      })
    }
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
   * Replace one editable PPTX text box draft.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice PPTX tab id.
   * @param slideIndex Original slide index.
   * @param elementIndex Original element index on the slide.
   * @param text Complete text-box text.
   * @param style Uniform text-box formatting.
   */
  editGenOfficePptx(
    sessionId: SessionId,
    id: string,
    slideIndex: number,
    elementIndex: number,
    text: string,
    style: GenOfficePptxTextStyle,
  ): void {
    this.sourceFor(sessionId).update((state) => {
      const tab = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-pptx')
      const slide = tab?.genOfficePptxSlides?.find(candidate => candidate.slideIndex === slideIndex)
      const element = slide?.elements.find(candidate => (
        candidate.elementIndex === elementIndex && candidate.kind === 'text' && candidate.editable
      ))
      if (tab === undefined || element?.kind !== 'text' || tab.genOfficePptxSaving === true) return
      element.text = text
      element.style = structuredClone(style)
      delete tab.genOfficePptxConflict
      delete tab.genOfficePptxError
    })
  }

  /**
   * Save one local PPTX draft through its GenOffice Host grant.
   * @param sessionId Session that owns the tab.
   * @param id GenOffice PPTX tab id.
   */
  async saveGenOfficePptx(sessionId: SessionId, id: string): Promise<void> {
    const store = this.sourceFor(sessionId)
    const tab = store.getSnapshot().tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-pptx')
    if (
      tab?.genOfficePptxGrantId === undefined
      || tab.genOfficePptxSlides === undefined
      || tab.genOfficePptxSavedSlides === undefined
      || tab.genOfficePptxRevision === undefined
      || tab.genOfficePptxSaving === true
    ) return
    const revision = tab.genOfficePptxRevision
    const saved = new Map(tab.genOfficePptxSavedSlides.flatMap(slide => slide.elements
      .filter(element => element.kind === 'text')
      .map(element => [`${String(slide.slideIndex)}:${String(element.elementIndex)}`, element] as const)))
    const edits = tab.genOfficePptxSlides.flatMap(slide => slide.elements.flatMap((element) => {
      if (element.kind !== 'text' || !element.editable) return []
      const before = saved.get(`${String(slide.slideIndex)}:${String(element.elementIndex)}`)
      if (before?.kind === 'text' && before.text === element.text
        && JSON.stringify(before.style) === JSON.stringify(element.style)) return []
      return [{
        slideIndex: slide.slideIndex,
        elementIndex: element.elementIndex,
        text: element.text,
        style: structuredClone(element.style),
      }]
    }))
    if (edits.length === 0) return
    store.update((state) => {
      const target = state.tabs.find(candidate => candidate.id === id)
      if (target === undefined) return
      target.genOfficePptxSaving = true
      delete target.genOfficePptxConflict
      delete target.genOfficePptxError
    })
    try {
      const response = await this.api.host.saveGenOfficePptxArtifact({
        grantId: tab.genOfficePptxGrantId,
        edits,
        revision,
      })
      const result = response.result
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-pptx')
        if (target === undefined) return
        target.genOfficePptxSaving = false
        if (result.ok) {
          target.genOfficePptxSlides = structuredClone(result.value.slides)
          target.genOfficePptxSavedSlides = structuredClone(result.value.slides)
          target.genOfficePptxRevision = result.value.revision
          delete target.genOfficePptxConflict
          delete target.genOfficePptxError
        } else {
          target.genOfficePptxConflict = result.error.code === 'artifact-preview-conflict'
          target.genOfficePptxError = result.error.message
        }
      })
    } catch (error: unknown) {
      store.update((state) => {
        const target = state.tabs.find(candidate => candidate.id === id && candidate.kind === 'genoffice-pptx')
        if (target === undefined) return
        target.genOfficePptxSaving = false
        target.genOfficePptxError = error instanceof Error ? error.message : String(error)
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
          clearHtmlEditing(tab)
          clearGenOfficePptx(tab)
          clearGenOfficeXlsx(tab)
          if (prepared.kind === 'html') {
            tab.url = prepared.url
            tab.htmlGrantId = prepared.grantId
            tab.htmlContent = prepared.content
            tab.htmlSavedContent = prepared.content
            tab.htmlRevision = prepared.revision
            tab.htmlSaving = false
            delete tab.htmlConflict
            delete tab.htmlError
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
          } else if (prepared.kind === 'genoffice-pptx') {
            tab.genOfficePptxGrantId = prepared.grantId
            tab.genOfficePptxSlides = structuredClone(prepared.slides)
            tab.genOfficePptxSavedSlides = structuredClone(prepared.slides)
            tab.genOfficePptxRevision = prepared.revision
            tab.genOfficePptxSaving = false
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
          clearGenOfficePptx(tab)
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
        clearGenOfficePptx(tab)
      })
    }
    return true
  }
}
