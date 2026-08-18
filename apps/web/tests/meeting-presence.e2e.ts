// Web e2e: the shipped Meetings sidebar contribution reaches the real Host
// meeting-presence Remote service. The invalid-link path starts no browser,
// so this scenario is keyless and deterministic while still crossing the
// browser uplink, API gateway, and Host URL validator.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/meeting-presence', import.meta.url))
const INVALID_EXPECTED = join(SNAPSHOT_DIR, 'invalid-link.expected.md')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: Google Meet presence panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens from the sidebar and renders the Host validation result', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-meeting-presence'))
    const trigger = page.getByRole('button', { name: '会议', exact: true })
    await trigger.waitFor({ timeout: 15_000 })
    expect(await trigger.getAttribute('aria-haspopup')).toBe('dialog')
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: '加入会议' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('textbox', { name: '会议链接' }).fill('https://example.com/not-a-meeting')
    await dialog.getByRole('button', { name: '加入会议' }).click()
    await dialog.getByText('请输入完整的 Google Meet 或 Zoom 会议链接。').waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(INVALID_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 30_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['invalid-link.expected.md'])
  })
})
