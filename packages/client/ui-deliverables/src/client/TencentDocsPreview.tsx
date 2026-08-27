/** Tencent Docs WebSDK loader and read-only preview mount. */

import type { TencentDocsEditorConfig } from '@deepseek-ai/dsh-client-connection/client'
import { useEffect, useRef, useState } from 'react'
import css from './ArtifactPreviewPanel.module.css'

interface TencentDocsInstance {
  ready(): Promise<void>
  destroy(): void
}

interface TencentDocsApi {
  init(config: TencentDocsEditorConfig & { mount: HTMLElement }): TencentDocsInstance
}

declare global {
  interface Window { TencentDocsSDK?: TencentDocsApi }
}

const scriptLoads = new Map<string, Promise<void>>()

/**
 * Convert an external SDK rejection into displayable text.
 * @param reason Value rejected by the third-party script or SDK.
 * @returns Error message or the string representation of a non-Error value.
 */
export function tencentDocsErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function loadApi(url: string): Promise<void> {
  if (window.TencentDocsSDK !== undefined) return Promise.resolve()
  const existing = scriptLoads.get(url)
  if (existing !== undefined) return existing
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.addEventListener('load', () => { resolve() }, { once: true })
    script.addEventListener('error', () => {
      scriptLoads.delete(url)
      reject(new Error(`Unable to load Tencent Docs WebSDK from ${url}`))
    }, { once: true })
    document.head.append(script)
  })
  scriptLoads.set(url, pending)
  return pending
}

/** Mount one Tencent Docs preview and destroy its iframe with the owning tab. */
export function TencentDocsPreview({ scriptUrl, config }: {
  scriptUrl: string
  config: TencentDocsEditorConfig
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    let instance: TencentDocsInstance | undefined
    void loadApi(scriptUrl).then(async () => {
      if (disposed) return
      if (window.TencentDocsSDK === undefined) throw new Error('Tencent Docs WebSDK loaded without TencentDocsSDK')
      // React runs effects only after attaching this rendered ref.
      const mount = mountRef.current as HTMLDivElement
      instance = window.TencentDocsSDK.init({ ...config, mount })
      await instance.ready()
    }).catch((reason: unknown) => {
      if (!disposed) setError(tencentDocsErrorMessage(reason))
    })
    return () => {
      disposed = true
      instance?.destroy()
    }
  }, [scriptUrl, config])

  return (
    <div className={css.tencentDocsRoot} data-tencent-docs-preview>
      <div ref={mountRef} className={css.officeEditor} />
      {error !== undefined && <div className={css.tencentDocsError} role="alert">{error}</div>}
    </div>
  )
}
