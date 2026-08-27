/** Read-only Tencent Docs WebSDK grants for workspace Office and PDF files. */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import type { ArtifactPreviewValue, TencentDocsOfficeType } from './api/host.ts'
import type { TencentDocsCallbackAction, TencentDocsCallbackHeaders } from './api/downloads.ts'

/** Physical route prefix for Tencent Docs callbacks and granted file reads. */
export const TENCENT_DOCS_PREVIEW_PATH = '/api/tencent-docs'

/** Official browser SDK published by Tencent Docs. */
export const DEFAULT_TENCENT_DOCS_SDK_URL = 'https://cdn.addon.tencentsuite.com/lib/web-sdk/global.js'

/** Tencent accepts one application signature for 60 minutes. */
const SIGNATURE_MAX_AGE_SECONDS = 60 * 60

const OFFICE_TYPES = new Map<string, TencentDocsOfficeType>([
  ['.doc', 'doc'],
  ['.docx', 'docx'],
  ['.txt', 'txt'],
  ['.xls', 'xls'],
  ['.xlsx', 'xlsx'],
  ['.csv', 'csv'],
  ['.ppt', 'ppt'],
  ['.pptx', 'pptx'],
  ['.pdf', 'pdf'],
])

const CONTENT_TYPES = new Map<string, string>([
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.pdf', 'application/pdf'],
])

/** Deployment values needed by both the browser initialization and Tencent callbacks. */
export interface TencentDocsPreviewConfig {
  /** Application id assigned by Tencent Docs. */
  appId: string
  /** Public Harness origin reachable by Tencent Docs. */
  publicUrl: string
  /** Browser SDK URL; defaults to Tencent's public UMD bundle. */
  sdkUrl?: string
  /** Resolve the application secret for each signed operation. */
  resolveAppSecret: () => Promise<string | undefined>
}

interface TencentDocsGrant {
  readonly path: string
  readonly name: string
  readonly contentType: string
  readonly fileToken: string
  readonly downloadToken: string
}

/** Expected Tencent Docs preparation failure classified for the Host RPC. */
export class TencentDocsPreviewError extends Error {
  constructor(readonly reason: 'unsupported' | 'unavailable', message: string) {
    super(message)
    this.name = 'TencentDocsPreviewError'
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function sign(appId: string, appSecret: string, nonce: string, timestamp: string): string {
  const source = `app_id=${appId}&app_secret=${appSecret}&nonce=${nonce}&timestamp=${timestamp}`
  return createHash('sha1').update(source).digest('hex')
}

function equalSignature(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}

function failure(code: number, message: string): Response {
  return json({ code, message })
}

function rangeFor(header: string | undefined, size: number): { start: number; end: number } | undefined | null {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const rawStart = match[1] as string
  const rawEnd = match[2] as string
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  const requestedEnd = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

/** Process-local authority registry for Tencent Docs preview sessions. */
export class TencentDocsPreviewGrants {
  readonly #grants = new Map<string, TencentDocsGrant>()

  constructor(private readonly deployment?: TencentDocsPreviewConfig) {}

  /**
   * Exchange one supported workspace file for browser-safe WebSDK configuration.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Tencent Docs script location and signed initialization fields.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'tencent-docs' }>> {
    const officeType = OFFICE_TYPES.get(extname(path).toLowerCase())
    if (officeType === undefined) {
      throw new TencentDocsPreviewError('unsupported', `Tencent Docs preview does not support this file type: ${path}`)
    }
    if (this.deployment === undefined) {
      throw new TencentDocsPreviewError(
        'unavailable',
        'Tencent Docs preview needs an app id, app-secret credential reference, and public Harness URL',
      )
    }
    const appSecret = await this.deployment.resolveAppSecret()
    if (appSecret === undefined) {
      throw new TencentDocsPreviewError('unavailable', 'Tencent Docs preview app-secret credential is not configured')
    }

    let target: string
    try {
      target = await realpath(path)
      if (!(await stat(target)).isFile()) {
        throw new TencentDocsPreviewError('unavailable', `Tencent Docs preview target is not a regular file: ${path}`)
      }
    } catch (error: unknown) {
      if (error instanceof TencentDocsPreviewError) throw error
      throw new TencentDocsPreviewError(
        'unavailable',
        `Tencent Docs preview target is unavailable: ${(error as Error).message}`,
      )
    }

    const fileId = randomUUID()
    const nonce = randomUUID()
    const timeStamp = Math.floor(Date.now() / 1000)
    const fileToken = randomUUID()
    this.#grants.set(fileId, {
      path: target,
      name: basename(target),
      contentType: CONTENT_TYPES.get(extname(target).toLowerCase()) as string,
      fileToken,
      downloadToken: randomUUID(),
    })
    return {
      kind: 'tencent-docs',
      name: basename(target),
      scriptUrl: this.deployment.sdkUrl ?? DEFAULT_TENCENT_DOCS_SDK_URL,
      config: {
        appId: this.deployment.appId,
        signature: {
          sign: sign(this.deployment.appId, appSecret, nonce, String(timeStamp)),
          nonce,
          timeStamp,
        },
        officeType,
        fileId,
        fileToken,
        mode: 'simple',
      },
    }
  }

  /**
   * Answer one authenticated Tencent Docs metadata, permission, download, or watermark callback.
   * @param fileId Opaque preview grant id.
   * @param action Callback operation selected from the physical route.
   * @param headers Tencent authentication and file-token headers.
   * @returns Tencent's JSON response envelope.
   */
  async callback(
    fileId: string,
    action: TencentDocsCallbackAction,
    headers: TencentDocsCallbackHeaders,
  ): Promise<Response> {
    const grant = this.#grants.get(fileId)
    if (grant === undefined) return failure(10004, 'file not found')
    // Grants can only be minted after prepare has accepted a deployment.
    const deployment = this.deployment as TencentDocsPreviewConfig
    const { appId, nonce, timestamp, signature, fileToken } = headers
    if (appId === undefined || nonce === undefined || timestamp === undefined || signature === undefined) {
      return failure(10006, 'signature headers are incomplete')
    }
    const numericTimestamp = Number(timestamp)
    if (!Number.isSafeInteger(numericTimestamp) || Math.abs(Math.floor(Date.now() / 1000) - numericTimestamp) > SIGNATURE_MAX_AGE_SECONDS) {
      return failure(10006, 'signature timestamp is expired')
    }
    if (appId !== deployment.appId) return failure(10006, 'application id does not match')
    const appSecret = await deployment.resolveAppSecret()
    if (appSecret === undefined || !equalSignature(signature, sign(appId, appSecret, nonce, timestamp))) {
      return failure(10006, 'signature verification failed')
    }
    if (fileToken !== grant.fileToken) return failure(10001, 'file token is invalid')

    if (action === 'permission') {
      return json({
        code: 0,
        message: '',
        data: { user_id: 'deepseek-harness', read: true, copy: false, comment: false, print: false },
      })
    }
    if (action === 'file-info') {
      let metadata: Awaited<ReturnType<typeof stat>>
      try {
        metadata = await stat(grant.path)
      } catch {
        return failure(10004, 'file not found')
      }
      return json({
        code: 0,
        message: '',
        data: { id: fileId, name: grant.name, size: metadata.size, update_time: Math.floor(metadata.mtimeMs / 1000) },
      })
    }
    if (action === 'download-info') {
      const publicUrl = withoutTrailingSlash(deployment.publicUrl)
      return json({
        code: 0,
        message: '',
        data: { url: `${publicUrl}${TENCENT_DOCS_PREVIEW_PATH}/content/${fileId}/${grant.downloadToken}` },
      })
    }
    return json({ code: 0, message: '', data: { type: 0, value: '' } })
  }

  /**
   * Stream one granted source file, including single HTTP byte ranges.
   * @param fileId Opaque preview grant id.
   * @param downloadToken Capability returned only through the signed download-info callback.
   * @param range Requested HTTP Range header, when present.
   * @param signal Request cancellation propagated to the file stream.
   * @returns Full or partial file response; invalid capabilities answer 404.
   */
  async file(fileId: string, downloadToken: string, range: string | undefined, signal: AbortSignal): Promise<Response> {
    const grant = this.#grants.get(fileId)
    if (grant === undefined || grant.downloadToken !== downloadToken) {
      return new Response('Tencent Docs preview grant not found', { status: 404 })
    }
    let size: number
    try {
      size = (await stat(grant.path)).size
    } catch (error: unknown) {
      return new Response(
        `Tencent Docs preview file is unavailable: ${(error as Error).message}`,
        { status: 500 },
      )
    }
    if (size === 0) {
      if (range !== undefined) {
        return new Response('requested range is not satisfiable', {
          status: 416,
          headers: { 'content-range': 'bytes */0' },
        })
      }
      return new Response(null, {
        headers: {
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
          'content-length': '0',
          'content-type': grant.contentType,
          'x-content-type-options': 'nosniff',
        },
      })
    }
    const selected = rangeFor(range, size)
    if (selected === null) {
      return new Response('requested range is not satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${String(size)}` },
      })
    }
    const start = selected?.start ?? 0
    const end = selected?.end ?? size - 1
    const stream = createReadStream(grant.path, { start, end, signal })
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-length': String(end - start + 1),
      'content-type': grant.contentType,
      'x-content-type-options': 'nosniff',
    }
    if (selected !== undefined) headers['content-range'] = `bytes ${String(start)}-${String(end)}/${String(size)}`
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: selected === undefined ? 200 : 206,
      headers,
    })
  }
}
