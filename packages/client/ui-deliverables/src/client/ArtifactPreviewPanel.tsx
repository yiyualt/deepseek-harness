/** Right-column renderer for one sandboxed HTML artifact preview. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailsOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ArtifactPreviewState } from './artifact-preview-store.ts'
import type { NS } from './locales.ts'
import css from './ArtifactPreviewPanel.module.css'

/** Layout action injected into the preview entry. */
export interface ArtifactPreviewPanelInjected {
  hooks: {
    /** Session-owned lifecycle bound as usePreview. */
    preview: SnapshotStore<ArtifactPreviewState>
  }
  /** Activate one retained preview tab. */
  activatePreview: (id: string) => void
  /** Add and activate an empty preview tab. */
  newPreviewTab: () => void
  /** Close one preview tab. */
  closePreviewTab: (id: string) => void
  /** Close the shared right column without discarding its tabs. */
  closePreview: () => void
}

/** Full preview-panel props. */
export type ArtifactPreviewPanelProps = PropsRuntime<'details'> & { matched: DetailsOwnerProps }
  & InjectFace<ArtifactPreviewPanelInjected>
  & PropsLocale<typeof NS>

/** Render the retained HTML previews as a browser-style tab strip and viewport. */
export function ArtifactPreviewPanel({
  usePreview, activatePreview, newPreviewTab, closePreviewTab, closePreview, t,
}: ArtifactPreviewPanelProps) {
  const preview = usePreview(state => state)
  const active = preview.tabs.find(tab => tab.id === preview.activeId)
  return (
    <div className={css.root} data-artifact-preview>
      <div className={css.toolbar}>
        <div className={css.tabs} role="tablist" aria-label={t('preview.tabs')}>
          {preview.tabs.map((tab) => {
            const selected = tab.id === preview.activeId
            const label = tab.name === '' ? t('preview.newTab') : tab.name
            return (
              <div key={tab.id} className={css.tabItem} data-active={selected || undefined}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={css.tab}
                  title={tab.path || label}
                  onClick={() => { activatePreview(tab.id) }}
                >
                  <span className={css.tabLabel}>{label}</span>
                </button>
                <button
                  type="button"
                  className={css.tabClose}
                  aria-label={t('preview.closeTab', { name: label })}
                  onClick={() => { closePreviewTab(tab.id) }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className={css.newTab}
          aria-label={t('preview.addTab')}
          onClick={newPreviewTab}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className={css.panelClose}
          aria-label={t('preview.close')}
          onClick={closePreview}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>
        {active?.status === 'loading' && (
          <div className={css.status} role="status">{t('preview.loading')}</div>
        )}
        {active?.status === 'error' && (
          <div className={css.error} role="alert">{active.error ?? t('preview.failed')}</div>
        )}
        {active?.status === 'idle' && (
          <div className={css.blank}>{t('preview.blank')}</div>
        )}
        {preview.tabs.map(tab => tab.status === 'ready' && tab.url !== undefined && (
          <div
            key={tab.id}
            className={css.framePane}
            role="tabpanel"
            hidden={tab.id !== preview.activeId}
          >
            <iframe
              className={css.frame}
              src={tab.url}
              title={t('preview.frameTitle', { name: tab.name })}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
