/** Split source editor and rendered preview for one local Markdown artifact. */

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import css from './ArtifactPreviewPanel.module.css'

/** Render and edit one prepared Markdown tab. */
export function MarkdownEditor({ tab, edit, save, t }: {
  tab: ArtifactPreviewTab
  edit: (content: string) => void
  save: () => void
  t: ArtifactPreviewPanelProps['t']
}) {
  const content = tab.markdownContent ?? ''
  const dirty = content !== (tab.markdownSavedContent ?? '')
  return (
    <div className={css.markdownEditor} data-markdown-editor>
      <div className={css.markdownToolbar}>
        <span className={css.markdownState} role="status">
          {tab.markdownSaving === true
            ? t('preview.markdownSaving')
            : dirty ? t('preview.markdownUnsaved') : t('preview.markdownSaved')}
        </span>
        <button
          type="button"
          className={css.markdownSave}
          disabled={!dirty || tab.markdownSaving === true}
          onClick={save}
        >
          {t('preview.markdownSave')}
        </button>
      </div>
      {(tab.markdownConflict === true || tab.markdownError !== undefined) && (
        <div className={css.markdownError} role="alert">
          {tab.markdownConflict === true ? t('preview.markdownConflict') : tab.markdownError}
        </div>
      )}
      <div className={css.markdownSplit}>
        <textarea
          className={css.markdownSource}
          aria-label={t('preview.markdownSource')}
          value={content}
          spellCheck={false}
          onChange={(event) => { edit(event.target.value) }}
        />
        <div className={css.markdownPreview} aria-label={t('preview.markdownPreview')}>
          <MarkdownText text={content} />
        </div>
      </div>
    </div>
  )
}
