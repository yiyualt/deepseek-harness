/** Local GenOffice PPTX projection and conflict-safe text-box writes. */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  openPptx,
  savePptx,
  type OpenedPptx,
  type Paragraph,
  type SlideElement,
  type TextElement,
  type TextRun,
} from '@deepseek-ai/dsh-genoffice-pptx-engine'
import type {
  ArtifactPreviewValue,
  GenOfficePptxEdit,
  GenOfficePptxElement,
  GenOfficePptxSlide,
  GenOfficePptxTextStyle,
} from './api/host.ts'

/** Default maximum PPTX size parsed by the local editor. */
export const DEFAULT_GENOFFICE_PPTX_MAX_BYTES = 128 * 1024 * 1024

/** Local GenOffice PPTX editor limits. */
export interface GenOfficePptxConfig {
  /** Maximum source, browser projection, and saved file size. */
  maxBytes: number
}

interface GenOfficePptxGrant {
  path: string
  opened: OpenedPptx
  revision: string
}

/** Expected local PPTX preparation or save failure classified for Host RPC. */
export class GenOfficePptxError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'unavailable' | 'conflict',
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'GenOfficePptxError'
  }
}

function revision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function solidColor(fill: TextElement['fill']): string | undefined {
  return fill?.type === 'solid' && fill.color !== 'none' ? fill.color : undefined
}

function strokeColor(element: SlideElement): string | undefined {
  const stroke = 'stroke' in element ? element.stroke : undefined
  return stroke?.fill.type === 'solid' && stroke.fill.color !== 'none' ? stroke.fill.color : undefined
}

function textStyle(element: TextElement): GenOfficePptxTextStyle {
  const paragraph = element.text?.paragraphs[0]
  const run = paragraph?.runs[0]
  return {
    ...(run?.fontFamily === undefined ? {} : { fontFamily: run.fontFamily }),
    ...(run?.fontSize === undefined ? {} : { fontSize: run.fontSize }),
    bold: run?.bold ?? false,
    italic: run?.italic ?? false,
    underline: run?.underline ?? false,
    ...(run?.color === undefined || run.color === 'none' ? {} : { color: run.color }),
    align: paragraph?.align ?? 'left',
  }
}

function styleSignature(run: TextRun): string {
  return JSON.stringify({
    fontFamily: run.fontFamily,
    fontSize: run.fontSize,
    bold: run.bold ?? false,
    italic: run.italic ?? false,
    underline: run.underline ?? false,
    color: run.color,
  })
}

function isEditableText(element: TextElement): boolean {
  const paragraphs = element.text?.paragraphs ?? []
  const runs = paragraphs.flatMap(paragraph => paragraph.runs)
  const first = runs[0]
  const firstAlign = paragraphs[0]?.align ?? 'left'
  return first !== undefined
    && runs.every(run => run.field === undefined && run.hyperlink === undefined && styleSignature(run) === styleSignature(first))
    && paragraphs.every(paragraph => (paragraph.align ?? 'left') === firstAlign)
}

function frame(element: SlideElement, elementIndex: number) {
  const { offset, rot } = element.transform
  return {
    elementIndex,
    x: offset.x,
    y: offset.y,
    width: offset.cx,
    height: offset.cy,
    rotation: rot / 60_000,
  }
}

function projectedElement(element: SlideElement, elementIndex: number): GenOfficePptxElement {
  const placement = frame(element, elementIndex)
  if (element.type === 'text' || element.type === 'shape') {
    const fill = solidColor(element.fill)
    const stroke = strokeColor(element)
    if (element.text !== undefined) {
      return {
        ...placement,
        kind: 'text',
        text: element.text.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n'),
        editable: isEditableText(element),
        style: textStyle(element),
        ...(fill === undefined ? {} : { fill }),
        ...(stroke === undefined ? {} : { stroke }),
      }
    }
    return {
      ...placement,
      kind: 'shape',
      ...(fill === undefined ? {} : { fill }),
      ...(stroke === undefined ? {} : { stroke }),
    }
  }
  if (element.type === 'picture') {
    return {
      ...placement,
      kind: 'picture',
      ...(element.dataUrl === undefined ? {} : { dataUrl: element.dataUrl }),
      opacity: element.opacity ?? 1,
    }
  }
  return {
    ...placement,
    kind: 'protected',
    label: element.type === 'passthrough' ? element.kind : element.type,
  }
}

function project(opened: OpenedPptx): GenOfficePptxSlide[] {
  const { cx, cy } = opened.deck.size
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) {
    throw new Error('PPTX slide size must contain positive finite dimensions')
  }
  return opened.deck.slides.map((slide, slideIndex) => ({
    slideIndex,
    width: cx,
    height: cy,
    ...(slide.background?.type === 'solid' && slide.background.color !== 'none'
      ? { background: slide.background.color }
      : {}),
    elements: slide.elements.map(projectedElement),
  }))
}

function styledRun(template: TextRun | undefined, text: string, style: GenOfficePptxTextStyle): TextRun {
  const run: TextRun = {
    ...(template ?? {}),
    text,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize, fontSizeImplicit: false }),
    ...(style.color === undefined
      ? {}
      : { color: style.color, colorFollowsTheme: false, colorInherited: false }),
  }
  if (style.fontFamily !== undefined) {
    run.fontFamily = style.fontFamily
    run.fontImplicit = false
    delete run.latinFont
    delete run.eaFont
    delete run.csFont
  }
  return run
}

function editedParagraph(template: Paragraph | undefined, text: string, style: GenOfficePptxTextStyle): Paragraph {
  return {
    ...(template ?? {}),
    runs: [styledRun(template?.runs[0], text, style)],
    align: style.align,
    pPrExplicit: { ...(template?.pPrExplicit ?? {}), align: true },
  }
}

function applyEdit(opened: OpenedPptx, edit: GenOfficePptxEdit, path: string): void {
  const slide = opened.deck.slides[edit.slideIndex]
  const element = slide?.elements[edit.elementIndex]
  if (element === undefined || (element.type !== 'text' && element.type !== 'shape') || element.text === undefined) {
    throw new GenOfficePptxError('unavailable', path, 'PPTX edit references an unknown or protected text box')
  }
  if (!isEditableText(element)) {
    throw new GenOfficePptxError('unavailable', path, 'PPTX edit references a protected text box')
  }
  const templates = element.text.paragraphs
  element.text.paragraphs = edit.text.split('\n').map((text, index) => (
    editedParagraph(templates[index] ?? templates.at(-1), text, edit.style)
  ))
  element.dirty = true
  element.dirtyPPr = { align: true }
}

/** In-memory GenOffice edit grants bound to canonical PPTX paths. */
export class GenOfficePptxGrants {
  readonly #grants = new Map<string, GenOfficePptxGrant>()

  constructor(private readonly config: GenOfficePptxConfig) {}

  /**
   * Parse one PPTX file and issue its local edit grant.
   * @param path Absolute Host path resolved by the conversation owner.
   * @returns Browser-safe slides, revision, and opaque save grant.
   */
  async prepare(path: string): Promise<Extract<ArtifactPreviewValue, { kind: 'genoffice-pptx' }>> {
    if (extname(path).toLowerCase() !== '.pptx') {
      throw new GenOfficePptxError('unsupported', path, `GenOffice editing supports .pptx files only: ${path}`)
    }
    let target: string
    try {
      target = await realpath(path)
      const metadata = await stat(target)
      if (!metadata.isFile()) {
        throw new GenOfficePptxError('unavailable', path, `GenOffice target is not a regular file: ${path}`)
      }
      if (metadata.size > this.config.maxBytes) {
        throw new GenOfficePptxError(
          'unavailable', path, `PPTX artifact exceeds the ${String(this.config.maxBytes)} byte limit: ${path}`,
        )
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficePptxError) throw error
      throw new GenOfficePptxError(
        'unavailable', path,
        `GenOffice target is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    try {
      const bytes = await readFile(target)
      const opened = await openPptx(bytes)
      const slides = project(opened)
      if (Buffer.byteLength(JSON.stringify(slides), 'utf8') > this.config.maxBytes) {
        throw new GenOfficePptxError(
          'unavailable', target, 'PPTX browser projection exceeds the configured file-size limit',
        )
      }
      const grantId = randomUUID()
      const sourceRevision = revision(bytes)
      this.#grants.set(grantId, { path: target, opened, revision: sourceRevision })
      return {
        kind: 'genoffice-pptx',
        name: basename(target),
        grantId,
        slides,
        revision: sourceRevision,
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficePptxError) throw error
      throw new GenOfficePptxError(
        'unavailable', target,
        `PPTX artifact could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Save text-box edits when the granted file still matches its source revision.
   * @param grantId Opaque grant returned by {@link prepare}.
   * @param edits Changed text boxes and their uniform formatting.
   * @param expectedRevision Revision returned by the last read or save.
   * @returns Revision and browser-safe slides of the saved presentation.
   */
  async save(
    grantId: string,
    edits: readonly GenOfficePptxEdit[],
    expectedRevision: string,
  ): Promise<{ revision: string; slides: GenOfficePptxSlide[] }> {
    const grant = this.#grants.get(grantId)
    if (grant === undefined) {
      throw new GenOfficePptxError('unavailable', '', 'GenOffice edit grant is unavailable; reopen the file')
    }
    if (grant.revision !== expectedRevision) {
      throw new GenOfficePptxError('conflict', grant.path, `PPTX revision is stale; reopen it before saving: ${grant.path}`)
    }
    let current: Uint8Array
    try {
      current = await readFile(grant.path)
    } catch (error: unknown) {
      throw new GenOfficePptxError(
        'unavailable', grant.path,
        `PPTX file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (revision(current) !== expectedRevision) {
      throw new GenOfficePptxError('conflict', grant.path, `PPTX file changed on disk; reopen it before saving: ${grant.path}`)
    }
    if (Buffer.byteLength(JSON.stringify(edits), 'utf8') > this.config.maxBytes) {
      throw new GenOfficePptxError('unavailable', grant.path, 'PPTX edits exceed the configured file-size limit')
    }

    const seen = new Set<string>()
    const working = await openPptx(current)
    for (const edit of edits) {
      const key = `${String(edit.slideIndex)}:${String(edit.elementIndex)}`
      if (seen.has(key)) {
        throw new GenOfficePptxError('unavailable', grant.path, `PPTX edit repeats text box ${key}`)
      }
      seen.add(key)
      if (Buffer.byteLength(edit.text, 'utf8') > this.config.maxBytes) {
        throw new GenOfficePptxError('unavailable', grant.path, 'PPTX text box exceeds the configured file-size limit')
      }
      applyEdit(working, edit, grant.path)
    }

    let saved: Uint8Array
    let opened: OpenedPptx
    let slides: GenOfficePptxSlide[]
    try {
      saved = edits.length === 0 ? current : await savePptx(working)
      if (saved.byteLength > this.config.maxBytes) {
        throw new GenOfficePptxError(
          'unavailable', grant.path, `Saved PPTX exceeds the ${String(this.config.maxBytes)} byte limit`,
        )
      }
      opened = edits.length === 0 ? grant.opened : await openPptx(saved)
      slides = project(opened)
      if (Buffer.byteLength(JSON.stringify(slides), 'utf8') > this.config.maxBytes) {
        throw new GenOfficePptxError(
          'unavailable', grant.path, 'Saved PPTX browser projection exceeds the configured file-size limit',
        )
      }
      if (edits.length > 0) {
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
      }
    } catch (error: unknown) {
      if (error instanceof GenOfficePptxError) throw error
      throw new GenOfficePptxError(
        'unavailable', grant.path,
        `PPTX file could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const savedRevision = revision(saved)
    grant.opened = opened
    grant.revision = savedRevision
    return { revision: savedRevision, slides }
  }
}
