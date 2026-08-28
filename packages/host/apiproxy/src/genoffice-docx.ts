/** Local GenOffice DOCX parsing and conflict-safe paragraph writes. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  parseDocx,
  saveDocx,
  type Block,
  type GeneratedBlock,
  type ParsedDocFull,
  type Run,
  type SaveBlock,
} from '@deepseek-ai/dsh-genoffice-docx-engine'
import type { ArtifactPreviewValue, GenOfficeDocxEdit, GenOfficeDocxRun } from './api/host.ts'

/** Default maximum DOCX size parsed by the local editor. */
export const DEFAULT_GENOFFICE_DOCX_MAX_BYTES = 64 * 1024 * 1024

/** Local GenOffice DOCX editor limits. */
export interface GenOfficeDocxConfig {
  /** Maximum source and saved file size. */
  maxBytes: number
}

interface GenOfficeDocxGrant {
  path: string
  parsed: ParsedDocFull
  revision: string
}

/** Expected local DOCX preparation or save failure classified for Host RPC. */
export class GenOfficeDocxError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable' | 'conflict',
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'GenOfficeDocxError'
  }
}

function revision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function blockText(block: Block): string {
  return block.runs?.map(run => run.text).join('') ?? block.previewText ?? block.label ?? ''
}

function isPlainRun(run: Run): boolean {
  return run.image === undefined
    && run.math === undefined
    && run.ruby === undefined
    && run.noteRef === undefined
    && run.refField === undefined
    && run.instrField === undefined
    && run.fldBeginXml === undefined
    && run.xeTerm === undefined
    && run.ins === undefined
    && run.del === undefined
}

function isEditable(block: Block): boolean {
  return block.docxIndex !== null
    && (block.type === 'paragraph' || block.type === 'heading' || block.type === 'listItem')
    && block.textboxes === undefined
    && block.strayRuns === undefined
    && block.formulaDisplay === undefined
    && block.blockRevision === undefined
    && block.paraMarkDel === undefined
    && (block.runs?.every(isPlainRun) ?? true)
}

function browserRun(run: Run): GenOfficeDocxRun {
  return {
    text: run.text,
    ...(run.bold === undefined ? {} : { bold: run.bold }),
    ...(run.italic === undefined ? {} : { italic: run.italic }),
    ...(run.underline === undefined ? {} : { underline: run.underline }),
    ...(run.strike === undefined ? {} : { strike: run.strike }),
    ...(run.color === undefined ? {} : { color: run.color.toUpperCase() }),
    ...(run.sizeHalfPoints === undefined ? {} : { sizeHalfPoints: run.sizeHalfPoints }),
    ...(run.font === undefined ? {} : { font: run.font }),
    ...(run.shading === undefined ? {} : { shading: run.shading.toUpperCase() }),
  }
}

function browserAlign(block: Block): GenOfficeDocxEdit['align'] {
  if (block.format?.align === 'justify' || block.format?.align === 'distribute') return 'both'
  return block.format?.align
}

function preparedBlock(block: Block): Extract<ArtifactPreviewValue, { kind: 'genoffice-docx' }>['blocks'][number] | undefined {
  if (block.hidden || block.invisibleMarker || block.docxIndex === null) return undefined
  const align = browserAlign(block)
  const editable = isEditable(block)
  return {
    docxIndex: block.docxIndex,
    type: block.type,
    text: blockText(block),
    editable,
    ...(editable ? { runs: (block.runs ?? [{ text: '' }]).map(browserRun) } : {}),
    ...(align === undefined ? {} : { align }),
    ...(block.level === undefined ? {} : { level: block.level }),
    ...(block.label === undefined ? {} : { label: block.label }),
  }
}

function generatedBlock(block: Block, edit: GenOfficeDocxEdit): GeneratedBlock {
  const firstRun = block.runs?.[0]
  const runs: Run[] = edit.runs.map(run => ({
    ...(firstRun?.rawRPr === undefined ? {} : { rawRPr: firstRun.rawRPr }),
    text: run.text,
    ...(run.bold === undefined ? {} : { bold: run.bold }),
    ...(run.italic === undefined ? {} : { italic: run.italic }),
    ...(run.underline === undefined ? {} : { underline: run.underline }),
    ...(run.strike === undefined ? {} : { strike: run.strike }),
    ...(run.color === undefined ? {} : { color: run.color }),
    ...(run.sizeHalfPoints === undefined ? {} : { sizeHalfPoints: run.sizeHalfPoints }),
    ...(run.font === undefined ? {} : { font: run.font }),
    ...(run.shading === undefined ? {} : { shading: run.shading }),
  }))
  const align = edit.align === 'both' ? 'justify' : edit.align
  return {
    type: block.type as GeneratedBlock['type'],
    runs,
    ...(block.level === undefined ? {} : { level: block.level }),
    ...(block.styleId === undefined ? {} : { styleId: block.styleId }),
    ...(block.list === undefined ? {} : { list: block.list }),
    ...(block.format === undefined && align === undefined
      ? {}
      : { format: { ...(block.format ?? {}), ...(align === undefined ? {} : { align }) } }),
    ...(block.rawPPr === undefined ? {} : { rawPPr: block.rawPPr }),
    ...(block.bookmarks === undefined ? {} : { bookmarks: block.bookmarks }),
    ...(block.hiddenBookmarks === undefined ? {} : { hiddenBookmarks: block.hiddenBookmarks }),
    ...(block.commentStarts === undefined ? {} : { commentStarts: block.commentStarts }),
    ...(block.commentEnds === undefined ? {} : { commentEnds: block.commentEnds }),
    ...(block.sdtShell === undefined ? {} : { sdtShell: block.sdtShell }),
  }
}

/** In-memory GenOffice edit grants bound to canonical DOCX paths. */
export class GenOfficeDocxGrants {
  readonly #grants = new Map<string, GenOfficeDocxGrant>()

  constructor(private readonly config: GenOfficeDocxConfig) {}

  /**
   * Parse one DOCX file and issue its local edit grant.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Browser-safe blocks, revision, and opaque save grant.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'genoffice-docx' }>> {
    if (extname(path).toLowerCase() !== '.docx') {
      throw new GenOfficeDocxError('unsupported', path, `GenOffice editing supports .docx files only: ${path}`)
    }
    let target: string
    try {
      target = await realpath(path)
      const metadata = await stat(target)
      if (!metadata.isFile()) {
        throw new GenOfficeDocxError('unavailable', path, `GenOffice target is not a regular file: ${path}`)
      }
      if (metadata.size > this.config.maxBytes) {
        throw new GenOfficeDocxError(
          'unavailable', path, `DOCX artifact exceeds the ${String(this.config.maxBytes)} byte limit: ${path}`,
        )
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficeDocxError) throw error
      throw new GenOfficeDocxError(
        'unavailable', path,
        `GenOffice target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      const bytes = await readFile(target)
      const parsed = await parseDocx(bytes)
      const grantId = randomUUID()
      const sourceRevision = revision(bytes)
      this.#grants.set(grantId, { path: target, parsed, revision: sourceRevision })
      return {
        kind: 'genoffice-docx',
        name: basename(target),
        grantId,
        revision: sourceRevision,
        blocks: parsed.blocks.flatMap((block) => {
          const value = preparedBlock(block)
          return value === undefined ? [] : [value]
        }),
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficeDocxError) throw error
      throw new GenOfficeDocxError(
        'unavailable', target,
        `DOCX artifact could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Save paragraph edits when the granted file still matches its source revision.
   * @param grantId Opaque grant returned by {@link prepare}.
   * @param edits Complete rich-text values for editable paragraphs.
   * @param expectedRevision Revision returned by the last read or save.
   * @returns Canonical saved path, revision, and browser-safe blocks of the document.
   */
  async save(
    grantId: string,
    edits: readonly GenOfficeDocxEdit[],
    expectedRevision: string,
  ): Promise<{ path: string; revision: string; blocks: Extract<ArtifactPreviewValue, { kind: 'genoffice-docx' }>['blocks'] }> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) {
      throw new GenOfficeDocxError('unavailable', '', 'GenOffice edit grant is unavailable; reopen the file')
    }
    if (grant.revision !== expectedRevision) {
      throw new GenOfficeDocxError('conflict', grant.path, `DOCX revision is stale; reopen it before saving: ${grant.path}`)
    }
    let current: Uint8Array
    try {
      current = await readFile(grant.path)
    } catch (error: unknown) {
      throw new GenOfficeDocxError(
        'unavailable', grant.path,
        `DOCX file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (revision(current) !== expectedRevision) {
      throw new GenOfficeDocxError('conflict', grant.path, `DOCX file changed on disk; reopen it before saving: ${grant.path}`)
    }

    const editByIndex = new Map<number, GenOfficeDocxEdit>()
    for (const edit of edits) {
      if (editByIndex.has(edit.docxIndex)) {
        throw new GenOfficeDocxError('unavailable', grant.path, `DOCX edit repeats block ${String(edit.docxIndex)}`)
      }
      const text = edit.runs.map(run => run.text).join('')
      if (Buffer.byteLength(text, 'utf8') > this.config.maxBytes) {
        throw new GenOfficeDocxError('unavailable', grant.path, 'DOCX paragraph exceeds the configured file-size limit')
      }
      editByIndex.set(edit.docxIndex, edit)
    }

    const finalBlocks: SaveBlock[] = []
    for (const block of grant.parsed.blocks) {
      if (block.hidden || block.docxIndex === null) continue
      const edit = editByIndex.get(block.docxIndex)
      if (edit === undefined) {
        finalBlocks.push({ kind: 'original', docxIndex: block.docxIndex })
        continue
      }
      if (!isEditable(block)) {
        throw new GenOfficeDocxError('unavailable', grant.path, `DOCX block ${String(block.docxIndex)} is protected`)
      }
      editByIndex.delete(block.docxIndex)
      const currentRuns = (block.runs ?? [{ text: '' }]).map(browserRun)
      if (JSON.stringify(edit.runs) === JSON.stringify(currentRuns) && edit.align === browserAlign(block)) {
        finalBlocks.push({ kind: 'original', docxIndex: block.docxIndex })
        continue
      }
      finalBlocks.push({ kind: 'generated', block: generatedBlock(block, edit) })
    }
    if (editByIndex.size > 0) {
      throw new GenOfficeDocxError('unavailable', grant.path, 'DOCX edit references an unknown or protected block')
    }

    let saved: Uint8Array
    try {
      saved = await saveDocx(grant.parsed, finalBlocks)
      if (saved.byteLength > this.config.maxBytes) {
        throw new GenOfficeDocxError(
          'unavailable', grant.path, `Saved DOCX exceeds the ${String(this.config.maxBytes)} byte limit`,
        )
      }
      const temporary = join(dirname(grant.path), `.${basename(grant.path)}.${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, saved, { flag: 'wx', mode: 0o600 })
        await rename(temporary, grant.path)
      } catch (error: unknown) {
        try {
          await unlink(temporary)
        } catch {
          // A failed write may not create the temporary file; no other owner remains.
        }
        throw error
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficeDocxError) throw error
      throw new GenOfficeDocxError(
        'unavailable', grant.path,
        `DOCX file could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const parsed = await parseDocx(saved)
    const savedRevision = revision(saved)
    grant.parsed = parsed
    grant.revision = savedRevision
    return {
      path: grant.path,
      revision: savedRevision,
      blocks: parsed.blocks.flatMap((block) => {
        const value = preparedBlock(block)
        return value === undefined ? [] : [value]
      }),
    }
  }
}
