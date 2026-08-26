// Web e2e: the shipped Connectors sidebar contribution drives the real
// credential store, document-provider Host Remotes, dynamic MCP runtime, and
// the Kingsoft Docs kdocs-cli process boundary. Tencent's fixed endpoint is
// redirected to a local MCP fixture; Kingsoft uses a temporary executable
// configured through the normal overlay seam.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  recordFixture,
  watchConsole,
  webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const TENCENT_DOCS_ENDPOINT = 'https://docs.qq.com/openapi/mcp'
const VALID_TOKEN = 'web-e2e-valid-token'
const INVALID_TOKEN = 'web-e2e-invalid-token'
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/tencent-docs-connector', import.meta.url))
const DISCONNECTED_EXPECTED = join(SNAPSHOT_DIR, 'disconnected.expected.md')
const FAILED_EXPECTED = join(SNAPSHOT_DIR, 'failed.expected.md')
const CONNECTED_EXPECTED = join(SNAPSHOT_DIR, 'connected.expected.md')
const KINGSOFT_CONNECTED_EXPECTED = join(SNAPSHOT_DIR, 'kingsoft-connected.expected.md')
const KINGSOFT_ONLY_CONNECTED_EXPECTED = join(SNAPSHOT_DIR, 'kingsoft-only-connected.expected.md')
const READ_ONLY_EXPECTED = join(SNAPSHOT_DIR, 'read-only.expected.md')
const CONVERSATION_EXPECTED = join(SNAPSHOT_DIR, 'conversation.expected.md')
const ROUND_FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const MODE = webSnapshotMode()
const ROUND_PROMPT = '请调用 kingsoft_docs_call，service=drive，action=list-files，params={}。成功后只回复 KINGSOFT_DOCS_DONE。'

interface JsonRpcRequest {
  id?: number | string
  method: string
  params?: { name?: unknown }
}

interface McpFixture {
  endpoint: string
  seenAuthorization: Array<string | undefined>
  close(): Promise<void>
}

interface KdocsFixture {
  readonly command: string
  readonly invocationLog: string
  readonly overlayPath: string
  close(): Promise<void>
}

async function readJson(request: IncomingMessage): Promise<JsonRpcRequest> {
  let payload = ''
  for await (const chunk of request) payload += String(chunk)
  return JSON.parse(payload) as JsonRpcRequest
}

function sendJson(response: ServerResponse, id: number | string, result: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  seenAuthorization: Array<string | undefined>,
): Promise<void> {
  const authorization = request.headers.authorization
  seenAuthorization.push(authorization)
  if (authorization !== VALID_TOKEN) {
    response.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer',
    })
    response.end(JSON.stringify({ error: 'invalid_token' }))
    return
  }
  const message = await readJson(request)
  if (message.id === undefined) {
    response.writeHead(202).end()
    return
  }
  if (message.method === 'initialize') {
    sendJson(response, message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'tencent-docs-web-fixture', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'tools/list') {
    sendJson(response, message.id, {
      tools: [
        {
          name: 'list_documents',
          description: 'List Tencent Docs documents.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true },
        },
        {
          name: 'create_document',
          description: 'Create a Tencent Docs document.',
          inputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      ],
    })
    return
  }
  if (message.method === 'tools/call') {
    sendJson(response, message.id, { content: [{ type: 'text', text: 'fixture-document-list' }] })
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'method_not_found' }))
}

async function launchMcpFixture(): Promise<McpFixture> {
  const seenAuthorization: Array<string | undefined> = []
  const server = createServer((request, response) => {
    handleMcpRequest(request, response, seenAuthorization).catch(() => {
      response.writeHead(500).end('fixture failure')
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Tencent Docs MCP fixture did not bind TCP')
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    seenAuthorization,
    close: async () => {
      const closed: PromiseWithResolvers<void> = Promise.withResolvers()
      server.close(() => { closed.resolve() })
      await closed.promise
    },
  }
}

function interceptTencentDocsFetch(endpoint: string): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const requested = input instanceof Request ? input.url : String(input)
    if (requested !== TENCENT_DOCS_ENDPOINT) {
      return originalFetch(input, init)
    }
    return originalFetch(endpoint, init)
  }
  return () => { globalThis.fetch = originalFetch }
}

async function launchKdocsFixture(): Promise<KdocsFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kdocs-web-e2e-'))
  const command = join(root, 'kdocs-cli')
  const authState = join(root, 'authenticated')
  const invocationLog = join(root, 'invocations.jsonl')
  const overlayPath = join(root, 'cordis.patch.yml')
  const script = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
const authState = ${JSON.stringify(authState)}
const invocationLog = ${JSON.stringify(invocationLog)}
const argv = process.argv.slice(2)
const stdin = readFileSync(0, 'utf8')
appendFileSync(invocationLog, JSON.stringify({ argv, stdin, legacyTokenPresent: process.env.KINGSOFT_DOCS_TOKEN !== undefined }) + '\\n')
if (argv[0] === 'auth' && argv[1] === 'status') {
  process.stdout.write(JSON.stringify({ authenticated: existsSync(authState), token: 'fixture-secret-never-export' }))
} else if (argv[0] === 'auth' && argv[1] === 'login') {
  writeFileSync(authState, 'yes')
  process.stdout.write('browser login completed')
} else if (argv[0] === 'auth' && argv[1] === 'logout') {
  rmSync(authState, { force: true })
} else if (argv.includes('--help')) {
  process.stdout.write('drive list-files -- parent_id')
} else {
  process.stdout.write(JSON.stringify({ code: 0, data: { files: [{ id: 'kdocs-fixture-file' }] } }))
}
`
  await writeFile(command, script, 'utf8')
  await chmod(command, 0o755)
  await writeFile(overlayPath, `- id: kingsoft-docs-connector\n  config:\n    command: ${JSON.stringify(command)}\n    loginTimeoutMs: 30000\n    commandTimeoutMs: 10000\n    toolCallTimeoutMs: 30000\n    processGraceMs: 1000\n    maxInputBytes: 1048576\n    maxOutputBytes: 1048576\n`, 'utf8')
  return {
    command,
    invocationLog,
    overlayPath,
    close: () => rm(root, { recursive: true, force: true }),
  }
}

async function assertSecretConfinedToPasswordInput(page: Page, secret: string): Promise<void> {
  const exposed = await page.evaluate(candidate => ({
    bodyText: document.body.innerText.includes(candidate),
    markupOutsidePasswordInput: (() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement
      for (const input of clone.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
        input.removeAttribute('value')
      }
      return clone.outerHTML.includes(candidate)
    })(),
  }), secret)
  expect(exposed).toEqual({ bodyText: false, markupOutsidePasswordInput: false })
}

async function assertSecretAbsent(page: Page, secret: string): Promise<void> {
  expect(await page.evaluate(candidate => ({
    markup: document.documentElement.outerHTML.includes(candidate),
    bodyText: document.body.innerText.includes(candidate),
  }), secret)).toEqual({ markup: false, bodyText: false })
  expect(await page.locator('body').ariaSnapshot()).not.toContain(secret)
}

async function waitForFrame(
  page: Page,
  tripwire: ReturnType<typeof watchConsole>,
  browserConsole: readonly string[] = [],
): Promise<void> {
  try {
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '(unreadable body)')
    throw new Error(
      `Web frame did not mount. Body: ${body}\nPage errors: ${tripwire.pageErrors.join('\n')}\nConsole: ${browserConsole.join('\n')}`,
      { cause: error },
    )
  }
}

describe('web e2e: document connectors', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let fixture: McpFixture
  let kdocs: KdocsFixture
  let restoreFetch: () => void
  const browserConsole: string[] = []
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    fixture = await launchMcpFixture()
    kdocs = await launchKdocsFixture()
    restoreFetch = interceptTencentDocsFetch(fixture.endpoint)
    scaffold = await launchWebScaffold({
      extraOverlayPath: kdocs.overlayPath,
      ...(MODE === 'record' ? {} : { replayFixture: ROUND_FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    page.on('console', (message) => { browserConsole.push(message.text()) })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await waitForFrame(page, tripwire, browserConsole)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    restoreFetch?.()
    await fixture?.close()
    await kdocs?.close()
  })

  it('uses a write-only Tencent Token and a credential-free Kingsoft browser login', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-tencent-docs-connector'))
    const trigger = page.getByRole('button', { name: '连接器', exact: true })
    await trigger.waitFor({ timeout: 15_000 })
    expect(await trigger.getAttribute('aria-haspopup')).toBe('dialog')
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: '连接器' })
    const tencentCard = dialog.locator('[data-connector-id="tencentDocs"]')
    const kingsoftCard = dialog.locator('[data-connector-id="kingsoftDocs"]')
    const tokenInput = tencentCard.getByRole('textbox', { name: '空间 MCP Token' })
    await dialog.waitFor({ timeout: 10_000 })
    await tencentCard.getByText('尚未配置空间 MCP Token', { exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(() => tokenInput.isEnabled(), { timeout: 10_000 }).toBe(true)
    expect(await tokenInput.getAttribute('type')).toBe('password')
    const disconnected = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DISCONNECTED_EXPECTED, disconnected, MODE)

    await tokenInput.fill(INVALID_TOKEN)
    await assertSecretConfinedToPasswordInput(page, INVALID_TOKEN)
    expect(browserConsole.join('\n')).not.toContain(INVALID_TOKEN)
    await tencentCard.getByRole('button', { name: '连接', exact: true }).click()
    await tencentCard.getByRole('alert').getByText('腾讯文档拒绝了当前 Token，请更新后重试。').waitFor({ timeout: 15_000 })
    expect(await tokenInput.inputValue()).toBe('')
    await assertSecretAbsent(page, INVALID_TOKEN)
    expect(browserConsole.join('\n')).not.toContain(INVALID_TOKEN)
    const failed = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(FAILED_EXPECTED, failed, MODE)

    await tokenInput.fill(VALID_TOKEN)
    await assertSecretConfinedToPasswordInput(page, VALID_TOKEN)
    expect(browserConsole.join('\n')).not.toContain(VALID_TOKEN)
    await tencentCard.getByRole('button', { name: '重试连接', exact: true }).click()
    await tencentCard.getByText('已连接', { exact: true }).waitFor({ timeout: 15_000 })
    await tencentCard.getByText('已发现').waitFor({ timeout: 10_000 })
    expect(await tencentCard.getByText('2', { exact: true }).count()).toBe(1)
    expect(await tokenInput.inputValue()).toBe('')
    await assertSecretAbsent(page, VALID_TOKEN)
    expect(browserConsole.join('\n')).not.toContain(VALID_TOKEN)
    const connected = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONNECTED_EXPECTED, connected, MODE)
    expect(fixture.seenAuthorization).toContain(INVALID_TOKEN)
    expect(fixture.seenAuthorization.filter(value => value === VALID_TOKEN).length).toBeGreaterThanOrEqual(2)

    expect(await kingsoftCard.getByRole('textbox').count()).toBe(0)
    await kingsoftCard.getByRole('button', { name: '网页登录', exact: true }).click()
    await kingsoftCard.getByText('已连接', { exact: true }).waitFor({ timeout: 15_000 })
    await kingsoftCard.getByText('已发现').waitFor({ timeout: 10_000 })
    expect(await kingsoftCard.getByText('2', { exact: true }).count()).toBe(1)
    const loginInvocations = (await readFile(kdocs.invocationLog, 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line) as {
        argv: string[]
        legacyTokenPresent: boolean
      })
    expect(loginInvocations.map(invocation => invocation.argv)).toEqual([
      ['auth', 'status', '--compact'],
      ['auth', 'login', '--oauth-timeout', '29000'],
      ['auth', 'status', '--compact'],
    ])
    expect(loginInvocations.every(invocation => !invocation.legacyTokenPresent)).toBe(true)
    await assertSecretAbsent(page, 'fixture-secret-never-export')
    const kingsoftConnected = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(KINGSOFT_CONNECTED_EXPECTED, kingsoftConnected, MODE)

    await dialog.getByRole('button', { name: '关闭' }).click()
    await dialog.waitFor({ state: 'detached' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(ROUND_FIXTURE, 'utf8'))).toEqual([ROUND_PROMPT])
    }
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(ROUND_PROMPT)
    await input.press('Enter')
    const approval = page.locator('[data-approval-key]')
    await approval.waitFor({ timeout: 30_000 })
    await expect.poll(() => approval.textContent())
      .toContain('Kingsoft Docs action may read local files or change external data')
    await approval.getByRole('button', { name: '允许一次' }).click()
    const sessionId = await settled
    if (MODE === 'record') await recordFixture(scaffold, sessionId, ROUND_FIXTURE)
    await page.getByText('KINGSOFT_DOCS_DONE', { exact: true }).waitFor({ timeout: 15_000 })

    const requestHeader = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'request/header' }> =>
        event.type === 'request/header'
        && event.data.header.tools?.some(tool => tool.name === 'kingsoft_docs_call') === true,
    )
    const exposed = requestHeader?.data.header.tools?.find(tool => tool.name === 'kingsoft_docs_call')
    expect(exposed?.description).toContain('authenticated Kingsoft Docs CLI action')
    expect(exposed?.parameters).toMatchObject({
      type: 'object',
      properties: {
        service: { type: 'string' },
        action: { type: 'string' },
        params: { type: 'object' },
      },
    })
    expect(requestHeader?.data.header.tools?.some(tool => tool.name === 'kingsoft_docs_help')).toBe(true)
    const kingsoftCall = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
        event.type === 'tool/call' && event.data.name === 'kingsoft_docs_call',
    )
    if (kingsoftCall === undefined) throw new Error('the replayed turn did not call the Kingsoft Docs CLI tool')
    const kingsoftResult = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/result' }> =>
        event.type === 'tool/result' && event.data.message.source.callId === kingsoftCall.data.callId,
    )
    expect(kingsoftResult?.data.message.content[0]).toMatchObject({ isError: false })
    expect(JSON.stringify(kingsoftResult)).toContain('kdocs-fixture-file')
    const actionInvocations = (await readFile(kdocs.invocationLog, 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line) as { argv: string[]; stdin: string })
    expect(actionInvocations.at(-1)).toMatchObject({
      argv: ['drive', 'list-files', '-', '--output', 'json', '--timeout', '29000'],
      stdin: '{}',
    })
    expect(sessionEvents.some(event => event.type === 'approval/asked')).toBe(true)
    expect(sessionEvents.some(event => event.type === 'approval/decided'
      && event.data.outcome === 'allowed-once')).toBe(true)
    const conversation = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONVERSATION_EXPECTED, conversation, MODE)

    await page.getByRole('button', { name: '连接器', exact: true }).click()
    await dialog.waitFor({ timeout: 10_000 })

    await tencentCard.getByRole('button', { name: '断开并删除空间 MCP Token', exact: true }).click()
    await tencentCard.getByText('未连接', { exact: true }).waitFor({ timeout: 15_000 })
    await tencentCard.getByText('尚未配置空间 MCP Token', { exact: true }).waitFor({ timeout: 15_000 })
    const cleared = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(KINGSOFT_ONLY_CONNECTED_EXPECTED, cleared, MODE)

    await kingsoftCard.getByRole('button', { name: '退出登录', exact: true }).click()
    await kingsoftCard.getByText('未连接', { exact: true }).waitFor({ timeout: 15_000 })
    expect((await readFile(kdocs.invocationLog, 'utf8')).includes('"logout"')).toBe(true)
    const credentialDocument = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentialDocument).not.toMatch(/web-e2e-(?:invalid|valid)-token/)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})

describe('web e2e: Tencent Docs connector on a non-loopback origin', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ remoteAuthority: 'dsh-connectors.localhost' })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await waitForFrame(page, tripwire)
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 10_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders connector management as read-only', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-tencent-docs-connector-read-only'))
    await page.getByRole('button', { name: '连接器', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '连接器' })
    await dialog.getByText(/当前页面不是本机 loopback 地址/).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('textbox', { name: '空间 MCP Token' }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: '连接', exact: true }).count()).toBe(0)
    const readOnly = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READ_ONLY_EXPECTED, readOnly, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 30_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'connected.expected.md',
      'conversation.expected.md',
      'disconnected.expected.md',
      'failed.expected.md',
      'kingsoft-connected.expected.md',
      'kingsoft-only-connected.expected.md',
      'read-only.expected.md',
      'session.jsonl',
    ])
  })
})
