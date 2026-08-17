/**
 * HTML artifact previews. A privileged unary call exchanges one Host path
 * for an opaque grant; the GET surface serves regular files whose real paths
 * stay below the granted directory.
 */

import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'

/** Physical route prefix owned by the fetch carrier. */
export const ARTIFACT_PREVIEW_PATH = '/api/artifact-preview'

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
}

const PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** Successful grant material returned to the browser client. */
export interface ArtifactPreviewGrant {
  /** Display name of the granted HTML entry. */
  name: string
  /** Same-origin resource URL suitable for a sandboxed iframe. */
  url: string
}

/** Expected preparation failure classified for the Host RPC vocabulary. */
export class ArtifactPreviewError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'ArtifactPreviewError'
  }
}

interface StoredGrant {
  readonly root: string
}

function isInside(root: string, candidate: string): boolean {
  const tail = relative(root, candidate)
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !tail.startsWith(`..${sep === '/' ? '\\' : '/'}`))
}

function previewHeaders(path: string): Headers {
  return new Headers({
    'cache-control': 'no-store',
    'content-security-policy': PREVIEW_CSP,
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  })
}

/**
 * In-memory authority registry for HTML preview entry points and their local
 * subresources. Grants die with the ApiProxy instance.
 */
export class ArtifactPreviewGrants {
  readonly #grants = new Map<string, StoredGrant>()

  /**
   * Exchange one existing HTML file for an opaque preview URL.
   * @param path - absolute Host path resolved by the conversation owner.
   * @returns display name and opaque resource URL.
   * @throws {@link ArtifactPreviewError} for unsupported or unavailable files.
   */
  async prepare(path: string): Promise<ArtifactPreviewGrant> {
    if (!HTML_EXTENSIONS.has(extname(path).toLowerCase())) {
      throw new ArtifactPreviewError('unsupported', `artifact preview supports HTML files only: ${path}`)
    }
    let entry: string
    try {
      entry = await realpath(path)
      const metadata = await stat(entry)
      if (!metadata.isFile()) {
        throw new ArtifactPreviewError('unavailable', `artifact preview target is not a regular file: ${path}`)
      }
    } catch (error: unknown) {
      if (error instanceof ArtifactPreviewError) throw error
      throw new ArtifactPreviewError(
        'unavailable',
        `artifact preview target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const token = randomUUID()
    const name = basename(entry)
    this.#grants.set(token, { root: dirname(entry) })
    return {
      name,
      url: `${ARTIFACT_PREVIEW_PATH}/${token}/${encodeURIComponent(name)}`,
    }
  }

  /**
   * Read one granted entry or relative subresource.
   * @param token - opaque grant id from {@link prepare}.
   * @param requestedPath - URL-relative path below the grant root.
   * @param signal - request cancellation forwarded to the file read.
   * @returns isolated inline response; invalid or escaped targets answer 404.
   */
  async response(token: string, requestedPath: string, signal: AbortSignal): Promise<Response> {
    const grant = this.#grants.get(token)
    if (grant === undefined) return new Response('preview grant not found', { status: 404 })

    let decoded: string
    try {
      decoded = decodeURIComponent(requestedPath)
    } catch {
      return new Response('invalid preview path', { status: 400 })
    }
    if (decoded === '' || decoded.includes('\0')) return new Response('preview resource not found', { status: 404 })

    let target: string
    try {
      target = await realpath(resolve(grant.root, decoded))
      if (!isInside(grant.root, target)) return new Response('preview resource not found', { status: 404 })
      const metadata = await stat(target)
      if (!metadata.isFile()) return new Response('preview resource not found', { status: 404 })
    } catch {
      return new Response('preview resource not found', { status: 404 })
    }

    try {
      const body = await readFile(target, { signal })
      return new Response(body, { status: 200, headers: previewHeaders(target) })
    } catch (error: unknown) {
      if (signal.aborted) return new Response('preview request cancelled', { status: 499 })
      return new Response(
        `preview resource read failed: ${error instanceof Error ? error.message : String(error)}`,
        { status: 500 },
      )
    }
  }
}
