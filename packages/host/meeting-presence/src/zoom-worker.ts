/** Isolated Playwright worker for one presence-only Zoom Web Client participant. */

import { chromium, type Browser, type Frame, type Page } from 'playwright'

type ZoomContainer = Page | Frame
type WorkerState = 'waiting-admission' | 'joined' | 'left'

const [meetingUrlRaw, botNameRaw, timeoutRaw, pollRaw, headlessRaw, executablePathRaw] = process.argv.slice(2)

function emitState(status: WorkerState): void {
  process.stdout.write(`${JSON.stringify({ type: 'state', status })}\n`)
}

function emitError(code: string, message: string): void {
  process.stdout.write(`${JSON.stringify({ type: 'error', code, message: message.slice(0, 1000) })}\n`)
}

function workerArgs(): {
  meetingUrl: string
  botName: string
  joinTimeoutMs: number
  statusPollMs: number
  headless: boolean
} {
  const joinTimeoutMs = Number(timeoutRaw)
  const statusPollMs = Number(pollRaw)
  if (meetingUrlRaw === undefined || botNameRaw === undefined
    || !Number.isFinite(joinTimeoutMs) || joinTimeoutMs <= 0
    || !Number.isFinite(statusPollMs) || statusPollMs <= 0) {
    throw new Error('invalid worker arguments')
  }
  return {
    meetingUrl: meetingUrlRaw,
    botName: botNameRaw,
    joinTimeoutMs,
    statusPollMs,
    headless: headlessRaw === 'true',
  }
}

function webClientUrl(meetingUrl: string): string {
  const url = new URL(meetingUrl)
  url.pathname = url.pathname.replace(/^\/j\//, '/wc/join/')
  return url.toString()
}

async function acceptCookies(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /Accept Cookies|Accept all cookies|接受所有 Cookie/i }).first()
  const visible = await button.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)
  if (visible) await button.click()
}

async function zoomContainer(page: Page): Promise<ZoomContainer> {
  const input = page.locator('input[type="text"]').first()
  const iframe = page.locator('iframe#webclient')
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await input.isVisible().catch(() => false)) return page
    const handle = await iframe.elementHandle({ timeout: 500 }).catch(() => null)
    const frame = await handle?.contentFrame()
    if (frame !== null && frame !== undefined) return frame
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Zoom Web Client did not expose its meeting form or frame')
}

async function fillNameAndJoin(container: ZoomContainer, botName: string): Promise<void> {
  const input = container.locator([
    'input#input-for-name',
    'input[name="name"]',
    'input[placeholder*="name" i]',
    'input[type="text"]',
  ].join(', ')).first()
  await input.waitFor({ state: 'visible', timeout: 60_000 })
  await input.fill(botName)

  const join = container.getByRole('button', { name: /^(Join|加入|Beitreten)$/i }).first()
  await join.waitFor({ state: 'visible', timeout: 30_000 })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await join.isEnabled().catch(() => false)) {
      await join.click()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Zoom Join button did not become enabled')
}

async function joined(container: ZoomContainer): Promise<boolean> {
  const leave = container.locator([
    'button[aria-label*="Leave" i]',
    'button[title*="Leave" i]',
    'button[aria-label*="离开" i]',
  ].join(', ')).first()
  if (await leave.isVisible().catch(() => false)) return true
  const footer = container.locator('#wc-footer').first()
  const text = await footer.innerText({ timeout: 250 }).catch(() => '')
  const participants = text.match(/(\d+)\s*(?:participants|参会者|Teilnehmer)/i)
  return participants !== null && Number(participants[1]) > 0
}

async function ended(container: ZoomContainer): Promise<boolean> {
  const body = await container.locator('body').innerText().catch(() => '')
  return /meeting has been ended|host has ended|You have been removed|会议已结束|主持人已结束会议/i.test(body)
}

async function main(): Promise<void> {
  const { meetingUrl, botName, joinTimeoutMs, statusPollMs, headless } = workerArgs()
  let browser: Browser | undefined
  const stopped = new AbortController()
  const stop = async (): Promise<void> => {
    if (stopped.signal.aborted) return
    stopped.abort()
    await browser?.close().catch(() => {})
  }
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })

  try {
    browser = await chromium.launch({
      headless,
      ...(executablePathRaw === undefined || executablePathRaw === ''
        ? { channel: 'chrome' as const }
        : { executablePath: executablePathRaw }),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--disable-dev-shm-usage',
      ],
    })
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.route('**/*.exe', route => route.abort())
    await page.goto(webClientUrl(meetingUrl), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await acceptCookies(page)
    const container = await zoomContainer(page)
    await fillNameAndJoin(container, botName)
    emitState('waiting-admission')

    const deadline = Date.now() + joinTimeoutMs
    while (!stopped.signal.aborted && Date.now() < deadline) {
      if (await joined(container)) break
      if (await ended(container)) {
        emitError('ZOOM_MEETING_ENDED', 'Zoom 会议已经结束。')
        return
      }
      const body = await container.locator('body').innerText().catch(() => '')
      if (/meeting passcode|enter passcode|请输入会议密码/i.test(body)) {
        emitError('ZOOM_PASSCODE_REQUIRED', '该 Zoom 会议需要链接中未包含的会议密码。')
        return
      }
      await new Promise(resolve => setTimeout(resolve, statusPollMs))
    }
    if (stopped.signal.aborted) return
    if (!await joined(container)) {
      emitError('ADMISSION_TIMEOUT', '主持人没有在等待时间内允许会议助手加入。')
      return
    }
    emitState('joined')

    while (!stopped.signal.aborted) {
      if (await ended(container)) {
        emitState('left')
        return
      }
      await new Promise(resolve => setTimeout(resolve, statusPollMs))
    }
  } finally {
    await stop()
  }
}

main().catch((error: unknown) => {
  emitError('ZOOM_AUTOMATION_FAILED', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
