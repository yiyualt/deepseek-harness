// @vitest-environment jsdom
/** Browser registration, locale ownership, Remote subscription, and HMR teardown. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as MeetingInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'global' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const unsubscribe = vi.fn()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    $on = vi.fn(() => unsubscribe)
  }
  new RemoteService(ctx)
  ctx.provide('remote.meetingPresence', {
    get: vi.fn(() => Promise.resolve({ ok: true, value: {
      status: 'idle', meetingUrl: null, provider: null, botName: 'DeepSeek AI 会议助手',
      errorCode: null, errorMessage: null, updatedAt: new Date(0).toISOString(),
    } })),
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, unsubscribe }
}

describe('ui-meeting browser plugin', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.meetingPresence'])
  })

  it('registers the footer action and removes its state and subscription with the fiber', async () => {
    const { ctx, fiber, unsubscribe } = await bench()
    const entry = ctx.slots.entries('sidebar.footer.action')[0]
    expect(entry?.options).toMatchObject({ id: 'meeting', order: 0 })
    expect(entry?.locale).toBe(NS)
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(unsubscribe).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('owns matching Chinese and English dictionaries for its slot entry', async () => {
    const { ctx, fiber } = await bench()
    const t = ctx.locale.bind(NS)
    ctx.locale.setLocale('zh')
    expect(t('trigger')).toBe(zh.trigger)
    ctx.locale.setLocale('en')
    expect(t('trigger')).toBe(en.trigger)
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    await fiber.dispose()
    expect(t('trigger')).not.toBe(en.trigger)
    await ctx.fiber.dispose()
  })
})

describe('ui-meeting loader companions', () => {
  it('keeps the node half inert and reserves invariant ownership', async () => {
    expect(() => { applyNode() }).not.toThrow()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(MeetingInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
