import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { readBasicWorkbook } from '@deepseek-ai/dsh-genoffice-xlsx-engine'
import { GenOfficeXlsxError, GenOfficeXlsxGrants } from '../src/genoffice-xlsx.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-genoffice-xlsx-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function workbook(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Original</t></is></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>'),
    'docProps/custom.xml': strToU8('<custom>preserve-me</custom>'),
  })
}

describe('GenOfficeXlsxGrants', () => {
  it('parses sheets and saves value, formula, and formatting edits into the original XLSX', async () => {
    const path = join(root, 'report.xlsx')
    await writeFile(path, workbook())
    const grants = new GenOfficeXlsxGrants({ maxBytes: 1024 * 1024 })
    const prepared = await grants.prepare(path)

    expect(prepared).toMatchObject({
      kind: 'genoffice-xlsx',
      name: 'report.xlsx',
      sheets: [{ name: 'Sheet1', cells: [
        { address: 'A1', value: 'Original' },
        { address: 'B1', value: 2 },
      ] }],
    })

    const saved = await grants.save(prepared.grantId, [
      { sheetName: 'Sheet1', row: 0, column: 0, writeValue: true, value: 'Edited' },
      {
        sheetName: 'Sheet1', row: 0, column: 1, writeValue: true, value: null,
        formula: '=1+2', style: { bold: true, fillColor: '#FFF2CC' },
      },
    ], prepared.revision)

    expect(saved.revision).not.toBe(prepared.revision)
    const bytes = await readFile(path)
    const parsed = await readBasicWorkbook(bytes)
    expect(parsed.snapshot.sheets[0]?.cells).toMatchObject({
      A1: { value: 'Edited' },
      B1: { value: null, formula: '=1+2' },
    })
    const entries = unzipSync(bytes)
    expect(new TextDecoder().decode(entries['docProps/custom.xml'])).toBe('<custom>preserve-me</custom>')
    expect(new TextDecoder().decode(entries['xl/worksheets/sheet1.xml'])).toMatch(/<c r="B1" s="[1-9][0-9]*"><f>1\+2<\/f><\/c>/)
  })

  it('rejects a save after the workbook changes on disk', async () => {
    const path = join(root, 'report.xlsx')
    await writeFile(path, workbook())
    const grants = new GenOfficeXlsxGrants({ maxBytes: 1024 * 1024 })
    const prepared = await grants.prepare(path)
    await writeFile(path, Buffer.concat([Buffer.from(workbook()), Buffer.from('changed')]))

    await expect(grants.save(prepared.grantId, [], prepared.revision)).rejects.toMatchObject({
      reason: 'conflict',
      path: expect.stringContaining('report.xlsx'),
    } satisfies Partial<GenOfficeXlsxError>)
  })
})
