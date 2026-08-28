/** Conflict-safe Markdown reads and writes for the Web artifact editor. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { ArtifactPreviewValue } from './api/host.ts'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024

interface MarkdownGrant {
  readonly path: string
}

/** Expected Markdown preparation or save failure classified for the Host RPC. */
export class MarkdownPreviewError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable' | 'conflict',
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'MarkdownPreviewError'
  }
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function assertSize(path: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new MarkdownPreviewError(
      'unavailable',
      path,
      `Markdown artifact exceeds the ${String(MAX_MARKDOWN_BYTES)} byte limit: ${path}`,
    )
  }
}

/** In-memory Markdown edit grants bound to canonical Host paths. */
export class MarkdownPreviewGrants {
  readonly #grants = new Map<string, MarkdownGrant>()

  /**
   * Read one Markdown file and issue its edit grant.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Source text, revision, and opaque save grant.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'markdown' }>> {
    if (!MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())) {
      throw new MarkdownPreviewError('unsupported', path, `Markdown preview supports .md and .markdown files only: ${path}`)
    }
    let target: string
    try {
      target = await realpath(path)
      const metadata = await stat(target)
      if (!metadata.isFile()) {
        throw new MarkdownPreviewError('unavailable', path, `Markdown preview target is not a regular file: ${path}`)
      }
      if (metadata.size > MAX_MARKDOWN_BYTES) {
        throw new MarkdownPreviewError(
          'unavailable', path, `Markdown artifact exceeds the ${String(MAX_MARKDOWN_BYTES)} byte limit: ${path}`,
        )
      }
    } catch (error: unknown) {
      if (error instanceof MarkdownPreviewError) throw error
      throw new MarkdownPreviewError(
        'unavailable', path,
        `Markdown preview target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      const content = await readFile(target, 'utf8')
      assertSize(target, content)
      const grantId = randomUUID()
      this.#grants.set(grantId, { path: target })
      return { kind: 'markdown', name: basename(target), grantId, content, revision: revision(content) }
    } catch (error: unknown) {
      if (error instanceof MarkdownPreviewError) throw error
      throw new MarkdownPreviewError(
        'unavailable', target,
        `Markdown preview target is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Replace a granted Markdown file when its source revision still matches.
   * @param grantId Opaque grant returned by {@link prepare}.
   * @param content Complete UTF-8 Markdown source to save.
   * @param expectedRevision Revision returned by the last read or save.
   * @returns Canonical saved path and revision of the content.
   */
  async save(grantId: string, content: string, expectedRevision: string): Promise<{ path: string; revision: string }> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) {
      throw new MarkdownPreviewError('unavailable', '', 'Markdown edit grant is unavailable; reopen the file')
    }
    assertSize(grant.path, content)
    let current: string
    try {
      current = await readFile(grant.path, 'utf8')
    } catch (error: unknown) {
      throw new MarkdownPreviewError(
        'unavailable', grant.path,
        `Markdown file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (revision(current) !== expectedRevision) {
      throw new MarkdownPreviewError('conflict', grant.path, `Markdown file changed on disk; reopen it before saving: ${grant.path}`)
    }

    const temporary = join(dirname(grant.path), `.${basename(grant.path)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, 'utf8')
      await rename(temporary, grant.path)
    } catch (error: unknown) {
      try {
        await unlink(temporary)
      } catch {
        // A failed write may not create the temporary file; no other owner remains.
      }
      throw new MarkdownPreviewError(
        'unavailable', grant.path,
        `Markdown file could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return { path: grant.path, revision: revision(content) }
  }
}
