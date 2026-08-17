/** ONLYOFFICE Docs API loader and editor mount. */

import type { OfficeEditorConfig } from '@deepseek-ai/dsh-client-connection/client'
import { useEffect, useId, useState } from 'react'
import css from './ArtifactPreviewPanel.module.css'

interface OnlyOfficeEditorInstance {
  destroyEditor(): void
}

interface OnlyOfficeApi {
  DocEditor: new (id: string, config: OfficeEditorConfig) => OnlyOfficeEditorInstance
}

declare global {
  interface Window { DocsAPI?: OnlyOfficeApi }
}

const scriptLoads = new Map<string, Promise<void>>()

function loadApi(url: string): Promise<void> {
  if (window.DocsAPI !== undefined) return Promise.resolve()
  const existing = scriptLoads.get(url)
  if (existing !== undefined) return existing
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.addEventListener('load', () => { resolve() }, { once: true })
    script.addEventListener('error', () => {
      scriptLoads.delete(url)
      reject(new Error(`Unable to load ONLYOFFICE API from ${url}`))
    }, { once: true })
    document.head.append(script)
  })
  scriptLoads.set(url, pending)
  return pending
}

/** Mount one editable DOCX editor and retain it until its tab closes. */
export function OnlyOfficeEditor({ apiUrl, config }: {
  apiUrl: string
  config: OfficeEditorConfig
}) {
  const reactId = useId()
  const id = `onlyoffice-${reactId.replaceAll(':', '')}`
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    let editor: OnlyOfficeEditorInstance | undefined
    void loadApi(apiUrl).then(() => {
      if (disposed) return
      if (window.DocsAPI === undefined) throw new Error('ONLYOFFICE API loaded without DocsAPI')
      editor = new window.DocsAPI.DocEditor(id, config)
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      disposed = true
      editor?.destroyEditor()
    }
  }, [apiUrl, config, id])

  if (error !== undefined) return <div className={css.error} role="alert">{error}</div>
  return <div id={id} className={css.officeEditor} data-onlyoffice-editor />
}
