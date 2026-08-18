/** Isolated Playwright worker that joins Google Meet without recording or uploading media. */

import { chromium, type Browser, type Page } from 'playwright'

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

async function continueWithoutDevices(page: Page): Promise<void> {
  const button = page.getByRole('button', {
    name: /Continue without microphone and camera|Ohne Mikrofon und Kamera fortfahren|在不使用麦克风和摄像头的情况下继续/i,
  }).first()
  const visible = await button.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true).catch(() => false)
  if (visible) await button.click()
}

async function disableDevices(page: Page): Promise<void> {
  for (const label of [
    /Turn off microphone|Mute microphone|Mikrofon ausschalten|关闭麦克风/i,
    /Turn off camera|Kamera ausschalten|关闭摄像头/i,
  ]) {
    const button = page.getByRole('button', { name: label }).first()
    const visible = await button.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true).catch(() => false)
    if (visible
      && await button.isEnabled().catch(() => false)) await button.click()
  }
}

async function clickJoin(page: Page): Promise<void> {
  const joinLabel = /Ask to join|Join now|Join anyway|Teilnahme erbitten|Jetzt teilnehmen|Trotzdem teilnehmen|请求加入|申请加入|立即加入|仍要加入/i
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const buttons = page.getByRole('button', { name: joinLabel })
    for (let index = 0; index < await buttons.count(); index++) {
      const button = buttons.nth(index)
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click()
        return
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const visibleButtons = await page.locator('button').evaluateAll(buttons => buttons
    .filter((button) => {
      const rect = button.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    .map(button => ({
      label: button.getAttribute('aria-label') ?? button.textContent.trim(),
      disabled: (button as HTMLButtonElement).disabled,
    })))
  throw new Error(`Google Meet join button did not become available. Visible buttons: ${JSON.stringify(visibleButtons)}`)
}

async function admitted(page: Page): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '')
  if (/Asking to join|Please wait.*admit|request.*join/i.test(body)) return false
  return await page.getByRole('button', { name: /Leave call|Anruf verlassen/i })
    .first().isVisible().catch(() => false)
}

async function removed(page: Page): Promise<boolean> {
  if (page.isClosed()) return true
  const body = await page.locator('body').innerText().catch(() => '')
  return /You have been removed|You left the meeting|Return to home screen/i.test(body)
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
    await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (page.url().startsWith('https://accounts.google.com/')) {
      emitError('SIGN_IN_REQUIRED', '该 Google Meet 不允许匿名访客加入。')
      return
    }
    await continueWithoutDevices(page)
    await disableDevices(page)
    const nameInput = page.locator('input[type="text"]').first()
    await nameInput.waitFor({ state: 'visible', timeout: 45_000 })
    await nameInput.fill(botName)
    await clickJoin(page)
    await continueWithoutDevices(page)
    emitState('waiting-admission')

    const deadline = Date.now() + joinTimeoutMs
    while (!stopped.signal.aborted && Date.now() < deadline) {
      if (await admitted(page)) break
      await new Promise(resolve => setTimeout(resolve, statusPollMs))
    }
    if (stopped.signal.aborted) return
    if (!await admitted(page)) {
      emitError('ADMISSION_TIMEOUT', '主持人没有在等待时间内允许会议助手加入。')
      return
    }
    emitState('joined')

    while (!stopped.signal.aborted) {
      if (await removed(page)) {
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
  emitError('GOOGLE_MEET_AUTOMATION_FAILED', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
