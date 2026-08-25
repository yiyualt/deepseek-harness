// @vitest-environment jsdom
/** Browser registration, locale ownership, Remote subscription, and HMR teardown. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { TencentDocsConnectorSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as ConnectorsInvariant from '../src/invariant.ts'
import { TENCENT_DOCS_CREDENTIAL_REF } from '../src/client/controller.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const SNAPSHOT: TencentDocsConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: true,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: '2026-08-25T00:00:00.000Z',
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'global' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const unsubscribe = vi.fn()
  const listeners = new Map<string, (value: never) => void>()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
    $on = vi.fn((event: string, next: (value: never) => void) => {
      listeners.set(event, next)
      return unsubscribe
    })
  }
  const remoteService = new RemoteService(ctx)
  const connector = {
    get: vi.fn(async () => ({ ok: true, value: SNAPSHOT })),
    publicGet: vi.fn(async () => ({
      ok: true,
      value: {
        status: 'connected',
        toolCount: 5,
        errorCode: null,
        errorMessage: null,
        updatedAt: SNAPSHOT.updatedAt,
      },
    })),
    connect: vi.fn(async () => ({ ok: true, value: { ...SNAPSHOT, status: 'connected' } })),
    disconnect: vi.fn(async () => ({ ok: true, value: SNAPSHOT })),
  }
  ctx.provide('remote.tencentDocsConnector', connector as never)
  const describe = vi.fn(async () => ({ result: { ok: true, value: { credentials: {
    [TENCENT_DOCS_CREDENTIAL_REF]: { configured: false, writable: true },
  } } } }))
  const set = vi.fn(async () => ({ result: { ok: true, value: {} } }))
  const unset = vi.fn(async () => ({ result: { ok: true, value: {} } }))
  ctx.provide('connection', { api: { credentials: { describe, set, unset } }, isLoopback } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx,
    fiber,
    unsubscribe,
    connector,
    describe,
    subscribedEvents: () => remoteService.$on.mock.calls.map(([event]) => event),
    dispatch: (event: string, value: unknown) => { listeners.get(event)?.(value as never) },
  }
}

describe('ui-connectors browser plugin', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.tencentDocsConnector', 'connection'])
  })

  it('registers one footer action and removes state and subscription with the fiber', async () => {
    const { ctx, fiber, unsubscribe, subscribedEvents } = await bench()
    const entry = ctx.slots.entries('sidebar.footer.action')[0]
    expect(entry?.options).toMatchObject({ id: 'connectors', order: -10 })
    expect(entry?.locale).toBe(NS)
    expect(subscribedEvents()).toEqual(['tencent-docs-connector/change', 'credentials/updated'])
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('binds pushed snapshots and loopback credential reconciliation to the injected face', async () => {
    const { ctx, fiber, describe, dispatch } = await bench()
    const entry = ctx.slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => {
      hooks: { connectors: { getSnapshot(): { connector: TencentDocsConnectorSnapshot } } }
      open(): void
      close(): void
      setDraft(value: string): void
      clearDraft(): void
      connect(): Promise<void>
      disconnect(): Promise<void>
    })()
    face.open()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledOnce() })
    dispatch('credentials/updated', 'SOME_OTHER_KEY')
    expect(describe).toHaveBeenCalledOnce()
    dispatch('credentials/updated', TENCENT_DOCS_CREDENTIAL_REF)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(2) })
    face.setDraft('temporary')
    face.clearDraft()
    face.setDraft('space-mcp-token')
    await face.connect()
    await face.disconnect()
    face.close()
    dispatch('tencent-docs-connector/change', {
      status: 'connected',
      toolCount: 6,
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-08-25T00:00:01.000Z',
    })
    expect(face.hooks.connectors.getSnapshot().connector).toMatchObject({ status: 'connected', toolCount: 6 })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('reads public state without calling loopback-pinned or credential methods for a non-loopback page', async () => {
    const { ctx, fiber, connector, describe, dispatch, subscribedEvents } = await bench(false)
    const entry = ctx.slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => {
      hooks: { connectors: { getSnapshot(): { connector: TencentDocsConnectorSnapshot } } }
      open(): void
    })()
    face.open()
    await vi.waitFor(() => { expect(connector.publicGet).toHaveBeenCalledOnce() })
    expect(connector.get).not.toHaveBeenCalled()
    expect(describe).not.toHaveBeenCalled()
    expect(subscribedEvents()).toEqual(['tencent-docs-connector/change'])
    expect(face.hooks.connectors.getSnapshot().connector).toMatchObject({ status: 'connected', toolCount: 5 })
    dispatch('credentials/updated', TENCENT_DOCS_CREDENTIAL_REF)
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
    dispatch('tencent-docs-connector/change', {
      status: 'connected',
      toolCount: 5,
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-08-25T00:00:01.000Z',
    })
    expect(face.hooks.connectors.getSnapshot().connector).toMatchObject({
      status: 'connected',
      toolCount: 5,
      credentialConfigured: false,
      credentialSource: null,
      credentialWritable: false,
    })
    await fiber.dispose()
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

describe('ui-connectors loader companions', () => {
  it('keeps the node half inert and reserves invariant ownership', async () => {
    expect(() => { applyNode() }).not.toThrow()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ConnectorsInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
