/** Right-column renderer for web, Markdown, and document artifacts. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailsOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useState, type FormEvent } from 'react'
import type { GenOfficeDocxBlock, GenOfficeXlsxEdit } from '@deepseek-ai/dsh-client-connection/client'
import type { ArtifactPreviewState } from './artifact-preview-store.ts'
import type { NS } from './locales.ts'
import css from './ArtifactPreviewPanel.module.css'
import { OnlyOfficeEditor } from './OnlyOfficeEditor.tsx'
import { MarkdownEditor } from './MarkdownEditor.tsx'
import { TencentDocsPreview } from './TencentDocsPreview.tsx'
import { GenOfficeDocxEditor } from './GenOfficeDocxEditor.tsx'
import { GenOfficeXlsxEditor } from './GenOfficeXlsxEditor.tsx'

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
  /** Navigate an empty preview tab to an HTTP(S) URL. */
  openPreviewUrl: (id: string, url: string) => boolean
  /** Replace one Markdown tab's draft source. */
  editMarkdown: (id: string, content: string) => void
  /** Save one Markdown tab's current draft. */
  saveMarkdown: (id: string) => void
  /** Replace one DOCX rich-text draft. */
  editGenOfficeDocx: (id: string, blocks: GenOfficeDocxBlock[]) => void
  /** Save one local GenOffice DOCX draft. */
  saveGenOfficeDocx: (id: string) => void
  /** Replace one XLSX cell-edit journal. */
  editGenOfficeXlsx: (id: string, edits: GenOfficeXlsxEdit[]) => void
  /** Save one local GenOffice XLSX journal. */
  saveGenOfficeXlsx: (id: string) => void
  /** Close one preview tab. */
  closePreviewTab: (id: string) => void
  /** Close the shared right column without discarding its tabs. */
  closePreview: () => void
}

/** Full preview-panel props. */
export type ArtifactPreviewPanelProps = PropsRuntime<'details'> & { matched: DetailsOwnerProps }
  & InjectFace<ArtifactPreviewPanelInjected>
  & PropsLocale<typeof NS>

function UrlEntry({ id, openPreviewUrl, t }: {
  id: string
  openPreviewUrl: (id: string, url: string) => boolean
  t: ArtifactPreviewPanelProps['t']
}) {
  const [url, setUrl] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInvalid(!openPreviewUrl(id, url))
  }

  return (
    <form className={css.urlEntry} onSubmit={submit}>
      <label className={css.urlLabel} htmlFor={`preview-url-${id}`}>{t('preview.urlLabel')}</label>
      <div className={css.urlControls}>
        <input
          id={`preview-url-${id}`}
          className={css.urlInput}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={url}
          placeholder={t('preview.urlPlaceholder')}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setUrl(event.target.value)
            if (invalid) setInvalid(false)
          }}
        />
        <button type="submit" className={css.urlOpen}>{t('preview.openUrl')}</button>
      </div>
      {invalid && <div className={css.urlError} role="alert">{t('preview.invalidUrl')}</div>}
      <div className={css.urlHint}>{t('preview.embedHint')}</div>
    </form>
  )
}

/** Render retained artifact previews as a browser-style tab strip. */
export function ArtifactPreviewPanel({
  usePreview, activatePreview, newPreviewTab, openPreviewUrl,
  editMarkdown, saveMarkdown, editGenOfficeDocx, saveGenOfficeDocx,
  editGenOfficeXlsx, saveGenOfficeXlsx,
  closePreviewTab, closePreview, t,
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
          <div className={css.blank}>
            <UrlEntry id={active.id} openPreviewUrl={openPreviewUrl} t={t} />
          </div>
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
        {preview.tabs.map(tab => (
          tab.status === 'ready'
          && tab.kind === 'genoffice-xlsx'
          && tab.genOfficeXlsxGrantId !== undefined
          && tab.genOfficeXlsxSheets !== undefined
          && (
            <div
              key={tab.id}
              className={css.framePane}
              role="tabpanel"
              hidden={tab.id !== preview.activeId}
            >
              <GenOfficeXlsxEditor
                tab={tab}
                edit={(edits) => { editGenOfficeXlsx(tab.id, edits) }}
                save={() => { saveGenOfficeXlsx(tab.id) }}
                t={t}
              />
            </div>
          )
        ))}
        {preview.tabs.map(tab => (
          tab.status === 'ready'
          && tab.kind === 'genoffice-docx'
          && tab.genOfficeGrantId !== undefined
          && tab.genOfficeBlocks !== undefined
          && (
            <div
              key={tab.id}
              className={css.framePane}
              role="tabpanel"
              hidden={tab.id !== preview.activeId}
            >
              <GenOfficeDocxEditor
                tab={tab}
                edit={(blocks) => { editGenOfficeDocx(tab.id, blocks) }}
                save={() => { saveGenOfficeDocx(tab.id) }}
                t={t}
              />
            </div>
          )
        ))}
        {preview.tabs.map(tab => (
          tab.status === 'ready'
          && tab.kind === 'markdown'
          && tab.markdownGrantId !== undefined
          && tab.markdownContent !== undefined
          && (
            <div
              key={tab.id}
              className={css.framePane}
              role="tabpanel"
              hidden={tab.id !== preview.activeId}
            >
              <MarkdownEditor
                tab={tab}
                edit={(content) => { editMarkdown(tab.id, content) }}
                save={() => { saveMarkdown(tab.id) }}
                t={t}
              />
            </div>
          )
        ))}
        {preview.tabs.map(tab => (
          tab.status === 'ready'
          && tab.kind === 'office'
          && tab.officeApiUrl !== undefined
          && tab.officeConfig !== undefined
          && (
            <div
              key={tab.id}
              className={css.framePane}
              role="tabpanel"
              hidden={tab.id !== preview.activeId}
            >
              <OnlyOfficeEditor apiUrl={tab.officeApiUrl} config={tab.officeConfig} />
            </div>
          )
        ))}
        {preview.tabs.map(tab => (
          tab.status === 'ready'
          && tab.kind === 'tencent-docs'
          && tab.tencentDocsScriptUrl !== undefined
          && tab.tencentDocsConfig !== undefined
          && (
            <div
              key={tab.id}
              className={css.framePane}
              role="tabpanel"
              hidden={tab.id !== preview.activeId}
            >
              <TencentDocsPreview
                scriptUrl={tab.tencentDocsScriptUrl}
                config={tab.tencentDocsConfig}
              />
            </div>
          )
        ))}
      </div>
    </div>
  )
}
