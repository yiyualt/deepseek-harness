/** Per-session state for the right-column HTML artifact preview. */

/** One HTML document retained as a browser-style preview tab. */
export interface ArtifactPreviewTab {
  id: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  requestId: number
  name: string
  path: string
  url?: string
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
