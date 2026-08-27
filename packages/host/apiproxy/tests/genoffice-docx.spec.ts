import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildBlankDocx, parseDocx, saveDocx } from '@deepseek-ai/dsh-genoffice-docx-engine'
import { GenOfficeDocxError, GenOfficeDocxGrants } from '../src/genoffice-docx.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-genoffice-docx-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeDocument(path: string, text: string): Promise<void> {
  const blank = await buildBlankDocx()
  const parsed = await parseDocx(blank)
  const bytes = await saveDocx(parsed, [{
    kind: 'generated',
    block: { type: 'paragraph', runs: [{ text }] },
  }])
  await writeFile(path, bytes)
}

describe('GenOfficeDocxGrants', () => {
  it('parses editable paragraphs and saves them back into the original DOCX', async () => {
    const path = join(root, 'essay.docx')
    await writeDocument(path, '原始作文')
    const grants = new GenOfficeDocxGrants({ maxBytes: 1024 * 1024 })
    const prepared = await grants.prepare(path)

    expect(prepared).toMatchObject({
      kind: 'genoffice-docx',
      name: 'essay.docx',
      blocks: [{ type: 'paragraph', text: '原始作文', editable: true }],
    })
    const block = prepared.blocks[0]
    expect(block).toBeDefined()

    const saved = await grants.save(prepared.grantId, [{
      docxIndex: block?.docxIndex ?? -1,
      runs: [{
        text: '修改后的作文', bold: true, italic: true, color: 'C00000', sizeHalfPoints: 32, font: 'Arial',
      }],
      align: 'center',
    }], prepared.revision)
    expect(saved.revision).not.toBe(prepared.revision)
    expect(saved.blocks[0]?.text).toBe('修改后的作文')
    const unchanged = await grants.save(prepared.grantId, saved.blocks
      .filter(block => block.editable)
      .map(block => ({
        docxIndex: block.docxIndex,
        runs: block.runs ?? [{ text: block.text }],
        ...(block.align === undefined ? {} : { align: block.align }),
      })),
    saved.revision)
    expect(unchanged.revision).toBe(saved.revision)
    const reparsed = await parseDocx(await readFile(path))
    expect(reparsed.blocks.find(candidate => !candidate.hidden)?.runs?.map(run => run.text).join(''))
      .toBe('修改后的作文')
    expect(reparsed.blocks.find(candidate => !candidate.hidden)).toMatchObject({
      format: { align: 'center' },
      runs: [{ bold: true, italic: true, color: 'C00000', sizeHalfPoints: 32, font: 'Arial' }],
    })
  })

  it('rejects unsupported paths and external changes without overwriting them', async () => {
    const path = join(root, 'essay.docx')
    await writeDocument(path, '原始作文')
    const grants = new GenOfficeDocxGrants({ maxBytes: 1024 * 1024 })
    await expect(grants.prepare(join(root, 'essay.txt'))).rejects.toMatchObject({ reason: 'unsupported' })

    const prepared = await grants.prepare(path)
    await writeDocument(path, '外部修改')
    await expect(grants.save(prepared.grantId, [], prepared.revision)).rejects.toMatchObject({
      reason: 'conflict',
      path: await realpath(path),
    } satisfies Partial<GenOfficeDocxError>)
    const reparsed = await parseDocx(await readFile(path))
    expect(reparsed.blocks.find(candidate => !candidate.hidden)?.runs?.map(run => run.text).join(''))
      .toBe('外部修改')
  })
})
