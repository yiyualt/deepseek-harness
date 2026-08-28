/** Visual and source editor for one granted local HTML artifact. */

import { useEffect, useRef, useState } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import css from './ArtifactPreviewPanel.module.css'

const EDITOR_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ')

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function editableDocument(content: string, resourceUrl: string): string {
  const baseUrl = new URL('./', new URL(resourceUrl, window.location.href)).href
  const document = new DOMParser().parseFromString(content, 'text/html')
  for (const script of document.querySelectorAll('script')) {
    const preserved = document.createElement('template')
    preserved.dataset.dshHtmlScript = ''
    preserved.content.append(script.cloneNode(true))
    script.replaceWith(preserved)
  }
  document.head.insertAdjacentHTML(
    'afterbegin',
    `<meta data-dsh-html-editor http-equiv="Content-Security-Policy" content="${escapeAttribute(EDITOR_CSP)}"><base data-dsh-html-editor href="${escapeAttribute(baseUrl)}">`,
  )
  const declaration = document.doctype === null ? '' : `<!DOCTYPE ${document.doctype.name}>\n`
  return `${declaration}${document.documentElement.outerHTML}`
}

function serialize(document: Document): string {
  const root = document.documentElement.cloneNode(true) as HTMLElement
  for (const node of root.querySelectorAll('[data-dsh-html-editor]')) node.remove()
  for (const node of root.querySelectorAll('template[data-dsh-html-script]')) {
    node.replaceWith((node as HTMLTemplateElement).content.cloneNode(true))
  }
  const declaration = document.doctype === null
    ? ''
    : `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId === '' ? '' : ` PUBLIC "${document.doctype.publicId}"`}${document.doctype.systemId === '' ? '' : ` "${document.doctype.systemId}"`}>\n`
  return `${declaration}${root.outerHTML}`
}

/** Render an in-page visual editor and an exact-source editing mode. */
export function HtmlEditor({ tab, edit, save, t }: {
  tab: ArtifactPreviewTab
  edit: (content: string) => void
  save: () => void
  t: ArtifactPreviewPanelProps['t']
}) {
  const content = tab.htmlContent ?? ''
  const dirty = content !== (tab.htmlSavedContent ?? '')
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const [visualSource, setVisualSource] = useState(content)
  const cleanup = useRef<() => void>()

  useEffect(() => () => { cleanup.current?.() }, [])

  const openMode = (next: 'visual' | 'source') => {
    if (next === 'visual') setVisualSource(content)
    setMode(next)
  }

  return <div className={css.htmlEditor} data-html-editor>
    <div className={css.htmlToolbar}>
      <div className={css.htmlModes} role="tablist" aria-label={t('preview.htmlModes')}>
        <button type="button" role="tab" aria-selected={mode === 'visual'}
          onClick={() => { openMode('visual') }}>{t('preview.htmlVisual')}</button>
        <button type="button" role="tab" aria-selected={mode === 'source'}
          onClick={() => { openMode('source') }}>{t('preview.htmlSource')}</button>
      </div>
      <span className={css.htmlState} role="status">
        {tab.htmlSaving === true
          ? t('preview.htmlSaving')
          : dirty ? t('preview.htmlUnsaved') : t('preview.htmlSaved')}
      </span>
      <button type="button" className={css.htmlSave}
        disabled={!dirty || tab.htmlSaving === true || tab.htmlConflict === true}
        onClick={save}>{t('preview.htmlSave')}</button>
    </div>
    {(tab.htmlConflict === true || tab.htmlError !== undefined) && <div className={css.htmlError} role="alert">
      {tab.htmlConflict === true ? t('preview.htmlConflict') : tab.htmlError}
    </div>}
    {mode === 'source' ? <textarea
      className={css.htmlSource}
      aria-label={t('preview.htmlSourceLabel')}
      value={content}
      spellCheck={false}
      onChange={(event) => { edit(event.target.value) }}
    /> : <iframe
      className={css.htmlVisual}
      srcDoc={editableDocument(visualSource, tab.url ?? window.location.href)}
      title={t('preview.htmlVisualLabel')}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={(event) => {
        cleanup.current?.()
        const document = event.currentTarget.contentDocument
        if (document === null) return
        document.designMode = 'on'
        const input = () => { edit(serialize(document)) }
        const preventNavigation = (click: MouseEvent) => {
          const ElementConstructor = document.defaultView?.Element
          if (ElementConstructor !== undefined
            && click.target instanceof ElementConstructor
            && click.target.closest('a') !== null) click.preventDefault()
        }
        document.addEventListener('input', input)
        document.addEventListener('click', preventNavigation)
        cleanup.current = () => {
          document.removeEventListener('input', input)
          document.removeEventListener('click', preventNavigation)
        }
      }}
    />}
  </div>
}
