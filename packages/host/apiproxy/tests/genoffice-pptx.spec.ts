import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addElement, createBlankPptx, openPptx, savePptx, type SlideElement, type TextElement,
} from '@deepseek-ai/dsh-genoffice-pptx-engine'
import { GenOfficePptxError, GenOfficePptxGrants } from '../src/genoffice-pptx.ts'

let root: string

function isTextElement(element: SlideElement): element is TextElement {
  return element.type === 'text' || element.type === 'shape'
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-genoffice-pptx-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function presentation(text: string): Promise<Uint8Array> {
  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]
  if (slide === undefined) throw new Error('blank PPTX has no slide')
  addElement(slide, {
    kind: 'textbox',
    offset: { x: 914_400, y: 914_400, cx: 5_486_400, cy: 1_371_600 },
    paragraphs: [{
      align: 'left',
      runs: [{ text, fontFamily: 'Arial', fontSize: 28, bold: false }],
    }],
  })
  return savePptx(opened)
}

describe('GenOfficePptxGrants', () => {
  it('projects positioned text boxes and saves text and uniform formatting into the original PPTX', async () => {
    const path = join(root, 'agentic-rl.pptx')
    await writeFile(path, await presentation('Agentic RL'))
    const grants = new GenOfficePptxGrants({ maxBytes: 8 * 1024 * 1024 })
    const prepared = await grants.prepare(path)
    const textBox = prepared.slides[0]?.elements.find(element => element.kind === 'text')

    expect(prepared).toMatchObject({ kind: 'genoffice-pptx', name: 'agentic-rl.pptx' })
    expect(textBox).toMatchObject({
      kind: 'text', text: 'Agentic RL', editable: true,
      x: 914_400, y: 914_400, width: 5_486_400, height: 1_371_600,
    })
    if (textBox?.kind !== 'text') throw new Error('presentation text box was not projected')

    const saved = await grants.save(prepared.grantId, [{
      slideIndex: 0,
      elementIndex: textBox.elementIndex,
      text: 'Agentic Reinforcement Learning',
      style: {
        fontFamily: 'Microsoft YaHei',
        fontSize: 32,
        bold: true,
        italic: false,
        underline: true,
        color: '#2457D6',
        align: 'center',
      },
    }], prepared.revision)

    expect(saved.revision).not.toBe(prepared.revision)
    expect(saved.slides[0]?.elements.find(element => element.kind === 'text')).toMatchObject({
      kind: 'text',
      text: 'Agentic Reinforcement Learning',
      style: {
        fontFamily: 'Microsoft YaHei', fontSize: 32, bold: true, underline: true, align: 'center',
      },
    })
    const reopened = await openPptx(await readFile(path))
    const element = reopened.deck.slides[0]?.elements.find(isTextElement)
    expect(element?.text?.paragraphs[0]?.runs[0]).toMatchObject({
      text: 'Agentic Reinforcement Learning', fontFamily: 'Microsoft YaHei', fontSize: 32, bold: true,
    })
    expect(element?.text?.paragraphs[0]?.align).toBe('center')
  })

  it('rejects unsupported paths and external changes without overwriting them', async () => {
    const path = join(root, 'deck.pptx')
    await writeFile(path, await presentation('Original'))
    const grants = new GenOfficePptxGrants({ maxBytes: 8 * 1024 * 1024 })
    await expect(grants.prepare(join(root, 'deck.ppt'))).rejects.toMatchObject({ reason: 'unsupported' })

    const prepared = await grants.prepare(path)
    await writeFile(path, await presentation('External change'))
    const canonicalPath = await realpath(path)
    await expect(grants.save(prepared.grantId, [], prepared.revision)).rejects.toMatchObject({
      reason: 'conflict',
      path: canonicalPath,
    } satisfies Partial<GenOfficePptxError>)
    const reopened = await openPptx(await readFile(path))
    const text = reopened.deck.slides[0]?.elements.find(isTextElement)
      ?.text?.paragraphs[0]?.runs[0]?.text
    expect(text).toBe('External change')
  })

  it('protects text boxes whose paragraphs do not share one alignment', async () => {
    const opened = await openPptx(await createBlankPptx())
    const slide = opened.deck.slides[0]
    if (slide === undefined) throw new Error('blank PPTX has no slide')
    addElement(slide, {
      kind: 'textbox',
      offset: { x: 914_400, y: 914_400, cx: 5_486_400, cy: 1_371_600 },
      paragraphs: [
        { align: 'left', runs: [{ text: 'Left', fontFamily: 'Arial', fontSize: 28 }] },
        { align: 'right', runs: [{ text: 'Right', fontFamily: 'Arial', fontSize: 28 }] },
      ],
    })
    const path = join(root, 'mixed-align.pptx')
    await writeFile(path, await savePptx(opened))

    const prepared = await new GenOfficePptxGrants({ maxBytes: 8 * 1024 * 1024 }).prepare(path)
    expect(prepared.slides[0]?.elements.find(element => element.kind === 'text')).toMatchObject({
      kind: 'text', text: 'Left\nRight', editable: false,
    })
  })

  it('bounds the complete browser projection after OOXML decompression', async () => {
    const path = join(root, 'compressed-text.pptx')
    const bytes = await presentation('A'.repeat(80_000))
    await writeFile(path, bytes)
    expect(bytes.byteLength).toBeLessThan(32 * 1024)

    await expect(new GenOfficePptxGrants({ maxBytes: 32 * 1024 }).prepare(path)).rejects.toMatchObject({
      reason: 'unavailable',
      message: 'PPTX browser projection exceeds the configured file-size limit',
    })
  })
})
