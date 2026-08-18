// Web e2e scenario: inline-code file mentions in the closing prose. Cold-seeds
// a built write turn (zero model calls) whose closing message names the written
// file three ways: by unique basename (links), ambiguously (stays inert), and
// as a file the turn never touched (stays inert). Package tests cover the
// resolver in isolation; only the assembled application shows a real write's
// locations reaching the prose as an opener. The HTML click exercises the
// assembled artifact-preview RPC, right-column entry, local iframe resource,
// and the empty-tab HTTP URL flow.
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'produced-file-mentions-web-e2e'
const DONE = 'FILE_MENTION_DONE'

/** One-part text content for a built message. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** The files the built turn writes; `notes.md` is named in prose but never written. */
const WRITES = ['site/report.html', 'site/other.html', 'site/report.docx', 'a/style.css', 'b/style.css']

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
          'Wrote `report.html`, `report.docx`, plus two `style.css` copies; `notes.md` untouched.',
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

  beforeAll(async () => {
    const server = createServer((request, response) => {
      if (request.url === '/embed') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><html><body><h1>Remote embed ready</h1></body></html>')
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
      onlyOffice: {
        browserUrl: `http://127.0.0.1:${String(address.port)}`,
        harnessUrl: 'http://127.0.0.1:9',
      },
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
    await writeFile(join(scaffold.workspaceCwd, 'site', 'report.docx'), 'fixture-docx')
    await seedSession(scaffold, mentionFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    const server = onlyOffice
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    }
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

    // Exactly two prose mentions link: the unique HTML and DOCX basenames
    // path; the shared `style.css` basename and unwritten `notes.md` stay code.
    const mentions = page.locator('[class*="markdown"] code button')
    await expect.poll(() => mentions.count(), { timeout: 10_000 }).toBe(2)
    expect(await mentions.first().innerText()).toBe('report.html')
    expect(await mentions.first().getAttribute('aria-label')).toBe('Open site/report.html')
    expect(await mentions.first().getAttribute('title')).toBe('site/report.html')
    // The turn still ends with its produced-files row (all four writes).
    expect(await page.getByText('Produced', { exact: true }).count()).toBe(1)

    await mentions.first().click()
    const preview = page.locator('[data-artifact-preview]')
    await preview.waitFor({ timeout: 10_000 })
    const frame = page.frameLocator('iframe[title="report.html preview"]')
    await expect.poll(() => frame.getByText('HTML preview ready', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)
    await frame.getByRole('button', { name: 'Start preview', exact: true }).click()
    await expect.poll(() => frame.getByText('running', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

    await page.getByRole('button', { name: 'Open site/other.html', exact: true }).click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(2)
    expect(await preview.getByRole('tab', { name: 'other.html', exact: true }).getAttribute('aria-selected')).toBe('true')
    await preview.getByRole('tab', { name: 'report.html', exact: true }).click()
    await expect.poll(() => frame.getByText('running', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

    await page.getByRole('button', { name: 'Open site/report.docx', exact: true }).first().click()
    await expect.poll(() => preview.getByRole('tab').count(), { timeout: 10_000 }).toBe(3)
    await expect.poll(() => preview.getByRole('button', { name: 'Edit report.docx', exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)

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
