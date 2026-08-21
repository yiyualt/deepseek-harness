/** Per-session state for the right-column artifact preview. */

import type { OfficeEditorConfig } from '@deepseek-ai/dsh-client-connection/client'

/** One HTML, Markdown, or Office document retained as a browser-style preview tab. */
export interface ArtifactPreviewTab {
  id: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  requestId: number
  name: string
  path: string
  kind?: 'html' | 'markdown' | 'office'
  url?: string
  markdownGrantId?: string
  markdownContent?: string
  markdownSavedContent?: string
  markdownRevision?: string
  markdownSaving?: boolean
  markdownConflict?: boolean
  markdownError?: string
  officeApiUrl?: string
  officeConfig?: OfficeEditorConfig
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
