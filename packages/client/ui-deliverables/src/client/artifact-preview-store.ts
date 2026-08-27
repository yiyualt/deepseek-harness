/** Per-session state for the right-column artifact preview. */

import type {
  GenOfficeDocxBlock, GenOfficePptxSlide, GenOfficeXlsxEdit, GenOfficeXlsxSheet,
  OfficeEditorConfig, TencentDocsEditorConfig,
} from '@deepseek-ai/dsh-client-connection/client'

/** One HTML, Markdown, or Office document retained as a browser-style preview tab. */
export interface ArtifactPreviewTab {
  id: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  requestId: number
  name: string
  path: string
  kind?: 'html' | 'markdown' | 'genoffice-docx' | 'genoffice-pptx' | 'genoffice-xlsx' | 'office' | 'tencent-docs'
  url?: string
  markdownGrantId?: string
  markdownContent?: string
  markdownSavedContent?: string
  markdownRevision?: string
  markdownSaving?: boolean
  markdownConflict?: boolean
  markdownError?: string
  genOfficeGrantId?: string
  genOfficeBlocks?: GenOfficeDocxBlock[]
  genOfficeSavedBlocks?: GenOfficeDocxBlock[]
  genOfficeRevision?: string
  genOfficeSaving?: boolean
  genOfficeConflict?: boolean
  genOfficeError?: string
  genOfficePptxGrantId?: string
  genOfficePptxSlides?: GenOfficePptxSlide[]
  genOfficePptxSavedSlides?: GenOfficePptxSlide[]
  genOfficePptxRevision?: string
  genOfficePptxSaving?: boolean
  genOfficePptxConflict?: boolean
  genOfficePptxError?: string
  genOfficeXlsxGrantId?: string
  genOfficeXlsxSheets?: GenOfficeXlsxSheet[]
  genOfficeXlsxEdits?: GenOfficeXlsxEdit[]
  genOfficeXlsxRevision?: string
  genOfficeXlsxSaving?: boolean
  genOfficeXlsxConflict?: boolean
  genOfficeXlsxError?: string
  officeApiUrl?: string
  officeConfig?: OfficeEditorConfig
  tencentDocsScriptUrl?: string
  tencentDocsConfig?: TencentDocsEditorConfig
  error?: string
}

/** Preview tabs retained while the session remains mounted. */
export interface ArtifactPreviewState {
  activeId?: string
  tabs: ArtifactPreviewTab[]
}

/**
 * Fresh idle state for one session-owned preview source.
 *
 * @returns An idle preview state with no selected path.
 */
export function initialArtifactPreviewState(): ArtifactPreviewState {
  return { tabs: [] }
}
