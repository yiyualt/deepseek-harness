// Web e2e scenario: inline-code file mentions in the closing prose. Cold-seeds
// a built write turn (zero model calls) whose closing message names the written
// file three ways: by unique basename (links), ambiguously (stays inert), and
// as a file the turn never touched (stays inert). Package tests cover the
// resolver in isolation; only the assembled application shows a real write's
// locations reaching the prose as an opener. The HTML click exercises the
// assembled artifact-preview RPC, right-column entry, local iframe resource,
// Markdown editing, durable human-edit awareness, Tencent Docs preview, and
// the empty-tab HTTP URL flow.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { strToU8, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { buildBlankDocx, parseDocx, saveDocx } from '@deepseek-ai/dsh-genoffice-docx-engine'
import { addElement, createBlankPptx, duplicateSlide, openPptx, savePptx } from '@deepseek-ai/dsh-genoffice-pptx-engine'
import { readBasicWorkbook } from '@deepseek-ai/dsh-genoffice-xlsx-engine'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'produced-file-mentions-web-e2e'
const DONE = 'FILE_MENTION_DONE'
const AWARENESS_DONE = 'ARTIFACT_EDIT_AWARENESS_DONE'
const TENCENT_SECRET_ENV = 'DSH_WEB_E2E_TENCENT_DOCS_SECRET'

/** One-part text content for a built message. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** The files the built turn writes. */
const WRITES = [
  'site/report.html', 'site/other.html', 'site/report.docx', 'site/report.xlsx', 'site/report.pptx', 'site/notes.md',
  'a/style.css', 'b/style.css',
]

/** One deterministic answer after the user asks about their local edits. */
function awarenessReplay(): ReplayOverrideDoc {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: AWARENESS_DONE },
    { type: 'block-end', index: 0, block: { type: 'text', text: AWARENESS_DONE } },
    { type: 'usage', usage: { inputTokens: 128, outputTokens: 8 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  return [{ kind: 'chunks', chunks }]
}

/** Minimal ordinary XLSX used by the assembled local-editor path. */
function xlsxFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Original sheet value</t></is></c></row></sheetData></worksheet>'),
  })
}

/** Two-slide PPTX used by the assembled local-editor path. */
async function pptxFixture(): Promise<Uint8Array> {
  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]
  if (slide === undefined) throw new Error('blank PPTX has no slide')
  addElement(slide, {
    kind: 'textbox',
    offset: { x: 914_400, y: 914_400, cx: 7_315_200, cy: 1_371_600 },
    paragraphs: [{
      align: 'left',
      runs: [{ text: 'Agentic RL', fontFamily: 'Arial', fontSize: 28, bold: false }],
    }],
  })
  if (duplicateSlide(opened, 0) === null) throw new Error('blank PPTX slide could not be duplicated')
  return savePptx(opened)
}

/** Build a settled write turn whose closing prose mentions files in inline code. */
function mentionFixture(): string {
  const session = Session.create(SessionId('produced-file-mentions-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Write two report pages and both stylesheets.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Produced file mentions',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const calls = WRITES.map((path, index) => ({
    path,
    callId: CallId(`file-mention-${String(index)}`),
    args: JSON.stringify({ file_path: path, content: `content of ${path}\n` }),
  }))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({
        type: 'tool-call' as const,
        id: call.callId,
        name: 'write',
        arguments: call.args,
      })),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: call.callId,
      name: 'write',
      arguments: call.args,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: text(`Created ${call.path}`),
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{
        type: 'text',
        text: [
          'Wrote `report.html`, `report.docx`, `report.xlsx`, `report.pptx`, `notes.md`, and preview `report.pdf`, plus two `style.css` copies.',
          '',
          DONE,
        ].join('\n'),
      }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: inline-code mentions of produced files', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let onlyOffice: Server | undefined
  let embedUrl: string
  let originalTencentSecret: string | undefined
  let replayDir: string
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-artifact-edit-awareness-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(awarenessReplay()))
    originalTencentSecret = process.env[TENCENT_SECRET_ENV]
    process.env[TENCENT_SECRET_ENV] = 'web-e2e-secret'
    const server = createServer((request, response) => {
      if (request.url === '/embed') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><html><body><h1>Remote embed ready</h1></body></html>')
        return
      }
      if (request.url === '/tencent.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end('window.TencentDocsSDK={init:function(config){var button=document.createElement("button");'
          + 'button.textContent="Tencent preview "+config.officeType;config.mount.append(button);'
          + 'return{ready:function(){return Promise.resolve()},destroy:function(){config.mount.replaceChildren()}}}}')
        return
      }
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end('window.DocsAPI={DocEditor:function(id,config){var root=document.getElementById(id);'
        + 'var button=document.createElement(\'button\');button.textContent=\'Edit \'+config.document.title;'
        + 'root.append(button);return{destroyEditor:function(){root.replaceChildren()}}}}')
    })
    onlyOffice = server
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('ONLYOFFICE test server did not bind TCP')
    embedUrl = `http://127.0.0.1:${String(address.port)}/embed`
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      onlyOffice: {
        browserUrl: `http://127.0.0.1:${String(address.port)}`,
        harnessUrl: 'http://127.0.0.1:9',
      },
      tencentDocs: {
        appId: 'web-e2e-app',
        appSecretEnv: TENCENT_SECRET_ENV,
        publicUrl: 'http://127.0.0.1:9',
        sdkUrl: `http://127.0.0.1:${String(address.port)}/tencent.js`,
      },
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => {
      sessionEvents.push(event)
    })
    await mkdir(join(scaffold.workspaceCwd, 'site'), { recursive: true })
    await writeFile(
      join(scaffold.workspaceCwd, 'site', 'report.html'),
      '<!doctype html><html><body><h1>HTML preview ready</h1><button id="start">Start preview</button><output id="status">idle</output><script>localStorage.setItem("preview-ready", "yes"); document.querySelector("#start").addEventListener("click", () => { document.querySelector("#status").textContent = "running" })</script></body></html>',
    )
    await writeFile(
      join(scaffold.workspaceCwd, 'site', 'other.html'),
      '<!doctype html><html><body><h1>Second HTML preview</h1></body></html>',
    )
    const blankDocx = await buildBlankDocx()
    const parsedDocx = await parseDocx(blankDocx)
    await writeFile(join(scaffold.workspaceCwd, 'site', 'report.docx'), await saveDocx(parsedDocx, [{
      kind: 'generated', block: { type: 'paragraph', runs: [{ text: 'GenOffice original text' }] },
    }]))
    await writeFile(join(scaffold.workspaceCwd, 'site', 'report.xlsx'), xlsxFixture())
    await writeFile(join(scaffold.workspaceCwd, 'site', 'report.pptx'), await pptxFixture())
    await writeFile(join(scaffold.workspaceCwd, 'report.pdf'), 'fixture-pdf')
    await writeFile(join(scaffold.workspaceCwd, 'site', 'notes.md'), '# Markdown ready\n\nInitial text.\n')
    await seedSession(scaffold, mentionFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    }
    const server = onlyOffice
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      }).catch((error: unknown) => failures.push(error))
    }
    if (originalTencentSecret === undefined) Reflect.deleteProperty(process.env, TENCENT_SECRET_ENV)
    else process.env[TENCENT_SECRET_ENV] = originalTencentSecret
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'produced file mentions cleanup failed')
  })

  it.skipIf(MODE === 'record')('links the unique mention and leaves ambiguous and unknown code inert', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-produced-file-mentions'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    // Exactly six prose mentions link; the shared `style.css` basename stays code.
    const mentions = page.locator('[class*="markdown"] code button')
    await expect.poll(() => mentions.count(), { timeout: 10_000 }).toBe(6)
    expect(await mentions.first().innerText()).toBe('report.html')
    expect(await mentions.first().getAttribute('aria-label')).toBe('Open site/report.html')
    expect(await mentions.first().getAttribute('title')).toBe('site/report.html')
    // The turn still ends with its produced-files row.
    expect(await page.getByText('Produced', { exact: true }).count()).toBe(1)

    await mentions.first().click()
    const preview = page.locator('[data-artifact-preview]')
    await preview.waitFor({ timeout: 10_000 })
    const frame = page.frameLocator('iframe[title="HTML visual editor"]')
    await expect.poll(() => frame.getByText('HTML preview ready', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)
    await frame.getByText('HTML preview ready', { exact: true }).dblclick()
    await page.keyboard.type('Editable')
    await expect.poll(() => frame.getByText('HTML preview Editable', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)
    await expect.poll(() => preview.getByText('Unsaved changes', { exact: true }).count()).toBe(1)
    await preview.getByRole('button', { name: 'Save to file', exact: true }).click()
    await expect.poll(() => preview.getByText('Saved', { exact: true }).count(), { timeout: 10_000 }).toBeGreaterThan(0)
    expect(await readFile(join(scaffold.workspaceCwd, 'site', 'report.html'), 'utf8'))
      .toContain('<h1>HTML preview Editable</h1>')

    await page.getByRole('button', { name: 'Open site/other.html', exact: true }).click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(2)
    expect(await preview.getByRole('tab', { name: 'other.html', exact: true }).getAttribute('aria-selected')).toBe('true')
    await preview.getByRole('tab', { name: 'report.html', exact: true }).click()
    await expect.poll(() => frame.getByText('HTML preview Editable', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

    await page.getByRole('button', { name: 'Open site/report.docx', exact: true }).first().click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(3)
    const initialPreviewWidth = await preview.evaluate(element => element.getBoundingClientRect().width)
    const detailsHandle = page.locator('[data-side="details"]')
    const handleBox = await detailsHandle.boundingBox()
    if (handleBox === null) throw new Error('details resize handle is not rendered')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x - 240, handleBox.y + handleBox.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(initialPreviewWidth + 200)
    const docxDocument = preview.getByLabel('DOCX document editor', { exact: true })
    await expect.poll(() => preview.getByRole('tab', { name: 'Insert', exact: true }).count()).toBe(1)
    await docxDocument.fill('Edited locally')
    await docxDocument.press('End')
    await docxDocument.press('Enter')
    await docxDocument.pressSequentially('with GenOffice')
    await docxDocument.selectText()
    const selectionToolbar = preview.getByRole('toolbar', { name: 'Selection formatting toolbar', exact: true })
    await expect.poll(() => selectionToolbar.count()).toBe(1)
    await expect.poll(() => preview.getByText('28 characters selected', { exact: true }).count()).toBe(1)
    await selectionToolbar.getByRole('button', { name: 'Bold', exact: true }).click()
    await preview.getByRole('button', { name: 'Save to file', exact: true }).click()
    await expect.poll(async () => {
      const saved = await parseDocx(await readFile(join(scaffold.workspaceCwd, 'site', 'report.docx')))
      return saved.blocks.find(block => !block.hidden)?.runs?.map(run => run.text).join('')
    }, { timeout: 10_000 }).toBe('Edited locally\nwith GenOffice')
    const savedDocx = await parseDocx(await readFile(join(scaffold.workspaceCwd, 'site', 'report.docx')))
    expect(savedDocx.blocks.find(block => !block.hidden)?.runs?.map(run => run.text).join(''))
      .toBe('Edited locally\nwith GenOffice')
    expect(savedDocx.blocks.find(block => !block.hidden)?.runs?.[0]?.bold).toBe(true)

    await page.getByRole('button', { name: 'Open site/report.xlsx', exact: true }).first().click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(4)
    const spreadsheet = preview.getByLabel('XLSX spreadsheet editor', { exact: true })
    await spreadsheet.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => preview.getByRole('tab', { name: 'Formulas', exact: true }).count()).toBe(1)
    await expect.poll(() => preview.getByText(
      'Use the native spreadsheet toolbar below to format the current cell selection.', { exact: true },
    ).count()).toBe(1)
    const spreadsheetEditor = spreadsheet.locator('..')
    const canvasBoxes = await spreadsheet.locator('canvas').evaluateAll(elements => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }))
    const spreadsheetBox = canvasBoxes.sort((left, right) => right.width * right.height - left.width * left.height)[0]
    if (spreadsheetBox === undefined) throw new Error('XLSX grid is not rendered')
    await page.mouse.click(spreadsheetBox.x + 86, spreadsheetBox.y + 35)
    await spreadsheet.locator('[data-u-comp="editor"]').last().focus()
    await page.keyboard.type('Edited locally in the grid')
    await page.keyboard.press('Enter')
    await expect.poll(() => spreadsheetEditor.getByText('Unsaved changes', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)
    await preview.getByRole('button', { name: 'Save to file', exact: true }).click()
    await expect.poll(() => spreadsheetEditor.getByText('Saved', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    const savedXlsxBytes = await readFile(join(scaffold.workspaceCwd, 'site', 'report.xlsx'))
    const savedXlsx = await readBasicWorkbook(savedXlsxBytes)
    expect(savedXlsx.snapshot.sheets[0]?.cells.A1?.value).toBe('Edited locally in the grid')

    await page.getByRole('button', { name: 'Open site/report.pptx', exact: true }).first().click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(5)
    const pptxEditor = preview.locator('[class*="genOfficePptxEditor"]')
    await expect.poll(() => pptxEditor.getByRole('tab', { name: 'Transitions', exact: true }).count()).toBe(1)
    await expect.poll(() => pptxEditor.getByRole('tab', { name: 'Slide Show', exact: true }).count()).toBe(1)
    await expect.poll(() => pptxEditor.getByText('Slide 1 of 2', { exact: true }).count()).toBe(1)
    await expect.poll(() => pptxEditor.locator('[data-slide-thumbnail]').filter({ hasText: 'Agentic RL' }).count()).toBe(2)
    const firstSlideTextBox = pptxEditor.getByLabel('Slide 1 text box 1', { exact: true })
    await firstSlideTextBox.focus()
    await page.keyboard.press('PageDown')
    await expect.poll(() => pptxEditor.getByText('Slide 2 of 2', { exact: true }).count()).toBe(1)
    const pptxTextBox = pptxEditor.getByLabel('Slide 2 text box 1', { exact: true })
    await pptxTextBox.fill('Agentic ')
    await pptxTextBox.pressSequentially('Reinforcement Learning')
    await pptxTextBox.focus()
    await expect.poll(() => pptxEditor.getByText('Text box 1 selected', { exact: true }).count()).toBe(1)
    await pptxEditor.getByRole('button', { name: 'Bold', exact: true }).click()
    await pptxEditor.getByRole('button', { name: 'Save to file', exact: true }).click()
    await expect.poll(() => pptxEditor.getByText('Saved', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    const savedPptx = await openPptx(await readFile(join(scaffold.workspaceCwd, 'site', 'report.pptx')))
    const savedPptxTextRun = savedPptx.deck.slides[1]?.elements.flatMap(element => (
      (element.type === 'text' || element.type === 'shape') && element.text !== undefined
        ? [element.text.paragraphs[0]?.runs[0]]
        : []
    )).find(run => run !== undefined)
    expect(savedPptxTextRun).toMatchObject({
      text: 'Agentic Reinforcement Learning', bold: true,
    })

    await page.getByRole('button', { name: 'Open report.pdf', exact: true }).click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(6)
    await expect.poll(() => preview.getByRole('button', { name: 'Tencent preview pdf', exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

    await page.getByRole('button', { name: 'Open site/notes.md', exact: true }).first().click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(7)
    const source = preview.getByLabel('Markdown source', { exact: true })
    await source.fill('# Markdown updated\n\nSaved from Web.\n')
    await expect.poll(() => preview.getByRole('heading', { name: 'Markdown updated' }).count(), {
      timeout: 10_000,
    }).toBe(1)
    await preview.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => preview.getByRole('status').filter({ hasText: 'Saved' }).count(), {
      timeout: 10_000,
    }).toBe(1)
    expect(await readFile(join(scaffold.workspaceCwd, 'site', 'notes.md'), 'utf8'))
      .toBe('# Markdown updated\n\nSaved from Web.\n')

    const humanEdits = sessionEvents.filter(event => event.type === 'artifact/edited')
    expect(humanEdits.map(event => event.data.format)).toEqual(['html', 'docx', 'xlsx', 'pptx', 'markdown'])
    expect(humanEdits.map(event => event.data.path)).toEqual([
      join(scaffold.workspaceCwd, 'site', 'report.html'),
      join(scaffold.workspaceCwd, 'site', 'report.docx'),
      join(scaffold.workspaceCwd, 'site', 'report.xlsx'),
      join(scaffold.workspaceCwd, 'site', 'report.pptx'),
      join(scaffold.workspaceCwd, 'site', 'notes.md'),
    ])

    const settled = scaffold.whenTurnSettled(60_000)
    const prompt = await scaffold.ctx.apiProxy.sessions.prompt({
      rpcId: 'artifact-edit-awareness-prompt' as never,
      payload: {
        sessionId: SessionId(SEED_ID),
        mode: 'queue',
        content: [{ type: 'text', text: 'Review the files I just edited.' }],
      },
    })
    expect(prompt.result).toMatchObject({ ok: true, value: { accepted: true } })
    await settled
    await page.getByText(AWARENESS_DONE, { exact: true }).waitFor({ timeout: 15_000 })
    const notice = sessionEvents.find(event => (
      event.type === 'user/message' && event.data.source.kind === 'artifact-edit'
    ))
    expect(notice).toBeDefined()
    if (notice?.type !== 'user/message') throw new Error('artifact edit notice was not logged')
    const noticeText = notice.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    for (const path of humanEdits.map(event => event.data.path)) expect(noticeText).toContain(path)

    await preview.getByRole('button', { name: 'New tab', exact: true }).click()
    await preview.getByLabel('Enter a website address', { exact: true }).fill(embedUrl)
    await preview.getByRole('button', { name: 'Open', exact: true }).click()
    const remoteFrame = page.frameLocator(`iframe[src="${embedUrl}"]`)
    await expect.poll(() => remoteFrame.getByText('Remote embed ready', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
