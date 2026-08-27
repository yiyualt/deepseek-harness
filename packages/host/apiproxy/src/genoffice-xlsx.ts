/** Local GenOffice XLSX parsing and conflict-safe cell writes. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  applyCellEditsToXlsx,
  readBasicWorkbook,
  type CellEdit,
} from '@deepseek-ai/dsh-genoffice-xlsx-engine'
import type {
  ArtifactPreviewValue,
  GenOfficeXlsxEdit,
} from './api/host.ts'

/** Default maximum XLSX size parsed by the local editor. */
export const DEFAULT_GENOFFICE_XLSX_MAX_BYTES = 64 * 1024 * 1024

/** Maximum cells sent to one browser editor. */
export const GENOFFICE_XLSX_CELL_LIMIT = 200_000

/** Local GenOffice XLSX editor limits. */
export interface GenOfficeXlsxConfig {
  /** Maximum source and saved file size. */
  maxBytes: number
}

interface GenOfficeXlsxGrant {
  path: string
  revision: string
  sheetNames: Set<string>
}

/** Expected local XLSX preparation or save failure classified for Host RPC. */
export class GenOfficeXlsxError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable' | 'conflict',
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'GenOfficeXlsxError'
  }
}

function revision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function browserWorkbook(
  imported: Awaited<ReturnType<typeof readBasicWorkbook>>,
): Extract<ArtifactPreviewValue, { kind: 'genoffice-xlsx' }>['sheets'] {
  return imported.snapshot.sheets.map(sheet => ({
    id: sheet.id,
    name: sheet.name,
    cells: Object.entries(sheet.cells).map(([address, cell]) => ({
      address,
      value: cell.value,
      ...(cell.formula === undefined ? {} : { formula: cell.formula }),
    })),
  }))
}

function engineEdit(edit: GenOfficeXlsxEdit): CellEdit {
  return {
    sheetName: edit.sheetName,
    row: edit.row,
    column: edit.column,
    writeValue: edit.writeValue,
    cell: {
      value: edit.value,
      ...(edit.formula === undefined ? {} : { formula: edit.formula }),
    },
    ...(edit.style === undefined ? {} : { style: edit.style }),
    ...(edit.styleReset === undefined ? {} : { styleReset: edit.styleReset }),
  }
}

/** In-memory GenOffice edit grants bound to canonical XLSX paths. */
export class GenOfficeXlsxGrants {
  readonly #grants = new Map<string, GenOfficeXlsxGrant>()

  constructor(private readonly config: GenOfficeXlsxConfig) {}

  /**
   * Parse one XLSX file and issue its local edit grant.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Browser-safe worksheets, revision, and opaque save grant.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'genoffice-xlsx' }>> {
    if (extname(path).toLowerCase() !== '.xlsx') {
      throw new GenOfficeXlsxError('unsupported', path, `GenOffice editing supports .xlsx files only: ${path}`)
    }
    let target: string
    try {
      target = await realpath(path)
      const metadata = await stat(target)
      if (!metadata.isFile()) {
        throw new GenOfficeXlsxError('unavailable', path, `GenOffice target is not a regular file: ${path}`)
      }
      if (metadata.size > this.config.maxBytes) {
        throw new GenOfficeXlsxError(
          'unavailable', path, `XLSX artifact exceeds the ${String(this.config.maxBytes)} byte limit: ${path}`,
        )
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficeXlsxError) throw error
      throw new GenOfficeXlsxError(
        'unavailable', path,
        `GenOffice target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      const bytes = await readFile(target)
      const imported = await readBasicWorkbook(bytes)
      const sheets = browserWorkbook(imported)
      const cellCount = sheets.reduce((total, sheet) => total + sheet.cells.length, 0)
      if (cellCount > GENOFFICE_XLSX_CELL_LIMIT) {
        throw new GenOfficeXlsxError(
          'unavailable', target,
          `XLSX artifact has more than ${String(GENOFFICE_XLSX_CELL_LIMIT)} populated cells`,
        )
      }
      const grantId = randomUUID()
      const sourceRevision = revision(bytes)
      this.#grants.set(grantId, {
        path: target,
        revision: sourceRevision,
        sheetNames: new Set(sheets.map(sheet => sheet.name)),
      })
      return {
        kind: 'genoffice-xlsx',
        name: basename(target),
        grantId,
        revision: sourceRevision,
        sheets,
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficeXlsxError) throw error
      throw new GenOfficeXlsxError(
        'unavailable', target,
        `XLSX artifact could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Save cell edits when the granted file still matches its source revision.
   * @param grantId Opaque grant returned by {@link prepare}.
   * @param edits User-authored cell value and style deltas.
   * @param expectedRevision Revision returned by the last read or save.
   * @returns Revision of the saved workbook.
   */
  async save(
    grantId: string,
    edits: readonly GenOfficeXlsxEdit[],
    expectedRevision: string,
  ): Promise<{ revision: string }> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) {
      throw new GenOfficeXlsxError('unavailable', '', 'GenOffice edit grant is unavailable; reopen the file')
    }
    if (grant.revision !== expectedRevision) {
      throw new GenOfficeXlsxError('conflict', grant.path, `XLSX revision is stale; reopen it before saving: ${grant.path}`)
    }
    let current: Buffer
    try {
      current = await readFile(grant.path)
    } catch (error: unknown) {
      throw new GenOfficeXlsxError(
        'unavailable', grant.path,
        `XLSX file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (revision(current) !== expectedRevision) {
      throw new GenOfficeXlsxError('conflict', grant.path, `XLSX file changed on disk; reopen it before saving: ${grant.path}`)
    }
    if (edits.length > GENOFFICE_XLSX_CELL_LIMIT) {
      throw new GenOfficeXlsxError('unavailable', grant.path, 'XLSX edit exceeds the populated-cell limit')
    }
    const seen = new Set<string>()
    for (const edit of edits) {
      if (!grant.sheetNames.has(edit.sheetName)) {
        throw new GenOfficeXlsxError('unavailable', grant.path, `XLSX edit names an unknown sheet: ${edit.sheetName}`)
      }
      const key = `${edit.sheetName}\u0000${String(edit.row)}\u0000${String(edit.column)}`
      if (seen.has(key)) {
        throw new GenOfficeXlsxError('unavailable', grant.path, 'XLSX edit repeats a cell')
      }
      seen.add(key)
    }

    try {
      const mutation = await applyCellEditsToXlsx(current, edits.map(engineEdit))
      if (mutation.buffer.byteLength > this.config.maxBytes) {
        throw new GenOfficeXlsxError(
          'unavailable', grant.path, `Saved XLSX exceeds the ${String(this.config.maxBytes)} byte limit`,
        )
      }
      const temporary = join(dirname(grant.path), `.${basename(grant.path)}.${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, mutation.buffer, { flag: 'wx', mode: 0o600 })
        await rename(temporary, grant.path)
      } catch (error: unknown) {
        try {
          await unlink(temporary)
        } catch {
          // A failed write may not create the temporary file; no other owner remains.
        }
        throw error
      }
      const savedRevision = revision(mutation.buffer)
      grant.revision = savedRevision
      return { revision: savedRevision }
    } catch (error: unknown) {
      if (error instanceof GenOfficeXlsxError) throw error
      throw new GenOfficeXlsxError(
        'unavailable', grant.path,
        `XLSX file could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
