/** Editable DOCX grants backed by an external ONLYOFFICE Document Server. */

import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ArtifactPreviewValue, OfficeEditorConfig } from './api/host.ts'

/** Physical route prefix used by ONLYOFFICE file reads and save callbacks. */
export const OFFICE_PREVIEW_PATH = '/api/office-preview'

/** Deployment addresses required by the browser and Document Server. */
export interface OfficePreviewConfig {
  /** Document Server origin reachable from the user's browser. */
  browserUrl: string
  /** Harness origin reachable from the Document Server process or container. */
  harnessUrl: string
}

interface OfficeGrant {
  readonly path: string
}

/** Expected DOCX preparation failure classified for the Host RPC. */
export class OfficePreviewError extends Error {
  constructor(readonly reason: 'unsupported' | 'unavailable', message: string) {
    super(message)
    this.name = 'OfficePreviewError'
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** In-memory DOCX authority registry and save target owner. */
export class OfficePreviewGrants {
  readonly #grants = new Map<string, OfficeGrant>()

  constructor(private readonly deployment?: OfficePreviewConfig) {}

  /**
   * Prepare an editable DOCX configuration without exposing its Host path.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Browser API location and Host-issued editor configuration.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'office' }>> {
    if (extname(path).toLowerCase() !== '.docx') {
      throw new OfficePreviewError('unsupported', `Office preview supports DOCX files only: ${path}`)
    }
    if (this.deployment === undefined) {
      throw new OfficePreviewError(
        'unavailable',
        'DOCX editing needs DSH_ONLYOFFICE_URL and DSH_ONLYOFFICE_HARNESS_URL',
      )
    }
    let target: string
    try {
      target = await realpath(path)
      if (!(await stat(target)).isFile()) {
        throw new OfficePreviewError('unavailable', `Office preview target is not a regular file: ${path}`)
      }
    } catch (error: unknown) {
      if (error instanceof OfficePreviewError) throw error
      throw new OfficePreviewError(
        'unavailable',
        `Office preview target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const token = randomUUID()
    const name = basename(target)
    const harnessUrl = withoutTrailingSlash(this.deployment.harnessUrl)
    const browserUrl = withoutTrailingSlash(this.deployment.browserUrl)
    this.#grants.set(token, { path: target })
    const config: OfficeEditorConfig = {
      width: '100%',
      height: '100%',
      documentType: 'word',
      document: {
        fileType: 'docx',
        key: token,
        title: name,
        url: `${harnessUrl}${OFFICE_PREVIEW_PATH}/${token}/file`,
        permissions: { edit: true, download: true },
      },
      editorConfig: {
        mode: 'edit',
        callbackUrl: `${harnessUrl}${OFFICE_PREVIEW_PATH}/${token}/callback`,
        customization: {},
        user: { id: 'deepseek-harness', name: 'DeepSeek Harness' },
      },
    }
    return {
      kind: 'office',
      name,
      apiUrl: `${browserUrl}/web-apps/apps/api/documents/api.js`,
      config,
    }
  }

  /**
   * Serve the current DOCX bytes to the Document Server.
   * @param token Opaque grant id.
   * @param signal Request cancellation for the file read.
   * @returns DOCX response or a plain error response.
   */
  async file(token: string, signal: AbortSignal): Promise<Response> {
    const grant = this.#grants.get(token)
    if (grant === undefined) return new Response('Office preview grant not found', { status: 404 })
    try {
      const body = await readFile(grant.path, { signal })
      return new Response(body, {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (error: unknown) {
      if (signal.aborted) return new Response('Office file request cancelled', { status: 499 })
      return new Response(
        `Office file read failed: ${error instanceof Error ? error.message : String(error)}`,
        { status: 500 },
      )
    }
  }

  /**
   * Accept an ONLYOFFICE callback and atomically replace the granted DOCX.
   * @param token Opaque grant id.
   * @param body Parsed callback JSON.
   * @param signal Request cancellation for the edited-file download.
   * @returns ONLYOFFICE callback acknowledgement.
   */
  async callback(token: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const grant = this.#grants.get(token)
    if (grant === undefined) return Response.json({ error: 1 }, { status: 404 })
    if (typeof body !== 'object' || body === null) return Response.json({ error: 1 }, { status: 400 })
    const { status, url } = body as { status?: unknown; url?: unknown }
    if (status !== 2 && status !== 6) return Response.json({ error: 0 })
    if (typeof url !== 'string') return Response.json({ error: 1 }, { status: 400 })

    const temporary = join(dirname(grant.path), `.${basename(grant.path)}.${randomUUID()}.tmp`)
    try {
      const edited = await fetch(url, { signal })
      if (!edited.ok) return Response.json({ error: 1 }, { status: 502 })
      await writeFile(temporary, Buffer.from(await edited.arrayBuffer()), { signal })
      await rename(temporary, grant.path)
      return Response.json({ error: 0 })
    } catch {
      try {
        await unlink(temporary)
      } catch {
        // Fetch or write can fail before the temporary file exists; cleanup has no remaining owner.
      }
      if (signal.aborted) return Response.json({ error: 1 }, { status: 499 })
      return Response.json({ error: 1 }, { status: 500 })
    }
  }
}
