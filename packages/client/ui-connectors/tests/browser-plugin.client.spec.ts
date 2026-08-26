// @vitest-environment jsdom
/** Browser registration, locale ownership, Remote subscription, and HMR teardown. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type {
  KingsoftDocsConnectorSnapshot,
  McpConnectorId,
  McpConnectorSnapshot,
  TencentDocsConnectorSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as ConnectorsInvariant from '../src/invariant.ts'
import {
  TENCENT_DOCS_CREDENTIAL_REF,
} from '../src/client/controller.ts'
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

const TENCENT_ID = 'tencent-docs' as McpConnectorId
const PRESENTATION = {
  logo: '文',
  name: { zh: '腾讯文档', en: 'Tencent Docs' },
  description: { zh: '腾讯文档', en: 'Tencent Docs' },
  credentialName: { zh: '空间 MCP Token', en: 'Space MCP Token' },
  credentialHelpUrl: 'https://docs.qq.com/open/document/mcp/get-token/',
  credentialHelpLabel: { zh: '获取 Token', en: 'Get Token' },
} as const

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
  const createConnector = () => ({
    list: vi.fn(async () => ({ ok: true as const, value: { connectors: [{
      id: TENCENT_ID,
      presentation: PRESENTATION,
      credentialRef: TENCENT_DOCS_CREDENTIAL_REF as never,
      snapshot: SNAPSHOT,
    }] } })),
    publicList: vi.fn(async () => ({
      ok: true,
      value: { connectors: [{ id: TENCENT_ID, presentation: PRESENTATION, snapshot: {
        status: 'connected' as const, toolCount: 5, errorCode: null, errorMessage: null,
        updatedAt: SNAPSHOT.updatedAt,
      } }] },
    })),
    connect: vi.fn(async () => ({ ok: true as const, value: {
      id: TENCENT_ID, presentation: PRESENTATION, credentialRef: TENCENT_DOCS_CREDENTIAL_REF as never,
      snapshot: { ...SNAPSHOT, status: 'connected' as const },
    } })),
    disconnect: vi.fn(async () => ({ ok: true as const, value: {
      id: TENCENT_ID, presentation: PRESENTATION, credentialRef: TENCENT_DOCS_CREDENTIAL_REF as never,
      snapshot: SNAPSHOT,
    } })),
  })
  const connector = createConnector()
  const kingsoftSnapshot: KingsoftDocsConnectorSnapshot = {
    status: 'disconnected',
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: SNAPSHOT.updatedAt,
  }
  const kingsoftConnector = {
    get: vi.fn(async () => ({ ok: true as const, value: kingsoftSnapshot })),
    publicGet: vi.fn(async () => ({ ok: true as const, value: {
      ...kingsoftSnapshot,
      status: 'connected' as const,
      toolCount: 2,
    } })),
    connect: vi.fn(async () => ({ ok: true as const, value: {
      ...kingsoftSnapshot,
      status: 'connected' as const,
      toolCount: 2,
    } })),
    disconnect: vi.fn(async () => ({ ok: true as const, value: kingsoftSnapshot })),
  }
  ctx.provide('remote.mcpConnectors', connector as never)
  ctx.provide('remote.kingsoftDocsConnector', kingsoftConnector as never)
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
    kingsoftConnector,
    describe,
    subscribedEvents: () => remoteService.$on.mock.calls.map(([event]) => event),
    dispatch: (event: string, value: unknown) => { listeners.get(event)?.(value as never) },
  }
}

describe('ui-connectors browser plugin', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual([
      'slots',
      'locale',
      'remote',
      'remote.kingsoftDocsConnector',
      'remote.mcpConnectors',
      'connection',
    ])
  })

  it('registers one footer action and removes state and subscription with the fiber', async () => {
    const { ctx, fiber, unsubscribe, subscribedEvents } = await bench()
    const entry = ctx.slots.entries('sidebar.footer.action')[0]
    expect(entry?.options).toMatchObject({ id: 'connectors', order: -10 })
    expect(entry?.locale).toBe(NS)
    expect(subscribedEvents()).toEqual([
      'mcp-connectors/change',
      'kingsoft-docs-connector/change',
      'credentials/updated',
    ])
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(unsubscribe).toHaveBeenCalledTimes(3)
    await ctx.fiber.dispose()
  })

  it('binds pushed snapshots and loopback credential reconciliation to the injected face', async () => {
    const { ctx, fiber, connector, kingsoftConnector, describe, dispatch } = await bench()
    const entry = ctx.slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => {
      hooks: {
        managedMcp: { getSnapshot(): { connectors: readonly [{ connector: McpConnectorSnapshot }] } }
        kingsoftDocs: { getSnapshot(): { connector: KingsoftDocsConnectorSnapshot } }
      }
      open(): void
      close(): void
      setManagedDraft(id: McpConnectorId, value: string): void
      connect(id: McpConnectorId | 'kingsoftDocs'): Promise<void>
      disconnect(id: McpConnectorId | 'kingsoftDocs'): Promise<void>
    })()
    face.open()
    await vi.waitFor(() => { expect(connector.list).toHaveBeenCalledOnce() })
    dispatch('credentials/updated', 'SOME_OTHER_KEY')
    expect(connector.list).toHaveBeenCalledOnce()
    dispatch('credentials/updated', TENCENT_DOCS_CREDENTIAL_REF)
    await vi.waitFor(() => { expect(connector.list).toHaveBeenCalledTimes(2) })
    expect(describe).not.toHaveBeenCalled()
    face.setManagedDraft(TENCENT_ID, 'temporary')
    face.setManagedDraft(TENCENT_ID, '')
    face.setManagedDraft(TENCENT_ID, 'space-mcp-token')
    await face.connect(TENCENT_ID)
    await face.disconnect(TENCENT_ID)
    await face.connect('kingsoftDocs')
    await face.disconnect('kingsoftDocs')
    expect(kingsoftConnector.connect).toHaveBeenCalledOnce()
    expect(kingsoftConnector.disconnect).toHaveBeenCalledOnce()
    face.close()
    dispatch('mcp-connectors/change', { connectors: [{ id: TENCENT_ID, presentation: PRESENTATION, snapshot: {
      status: 'connected', toolCount: 6, errorCode: null, errorMessage: null,
      updatedAt: '2026-08-25T00:00:01.000Z',
    } }] })
    expect(face.hooks.managedMcp.getSnapshot().connectors[0].connector)
      .toMatchObject({ status: 'connected', toolCount: 6 })
    dispatch('kingsoft-docs-connector/change', {
      status: 'connected',
      toolCount: 2,
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-08-25T00:00:02.000Z',
    })
    expect(face.hooks.kingsoftDocs.getSnapshot().connector).toMatchObject({ status: 'connected', toolCount: 2 })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('reads public state without calling loopback-pinned or credential methods for a non-loopback page', async () => {
    const { ctx, fiber, connector, kingsoftConnector, describe, dispatch, subscribedEvents } = await bench(false)
    const entry = ctx.slots.entries('sidebar.footer.action')[0]!
    const face = (entry.inject as unknown as () => {
      hooks: {
        managedMcp: { getSnapshot(): { connectors: readonly [{ connector: McpConnectorSnapshot }] } }
        kingsoftDocs: { getSnapshot(): { connector: KingsoftDocsConnectorSnapshot } }
      }
      open(): void
    })()
    face.open()
    await vi.waitFor(() => { expect(connector.publicList).toHaveBeenCalledOnce() })
    expect(kingsoftConnector.publicGet).toHaveBeenCalledOnce()
    expect(connector.list).not.toHaveBeenCalled()
    expect(describe).not.toHaveBeenCalled()
    expect(subscribedEvents()).toEqual([
      'mcp-connectors/change',
      'kingsoft-docs-connector/change',
    ])
    expect(face.hooks.managedMcp.getSnapshot().connectors[0].connector)
      .toMatchObject({ status: 'connected', toolCount: 5 })
    dispatch('credentials/updated', TENCENT_DOCS_CREDENTIAL_REF)
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
    dispatch('mcp-connectors/change', { connectors: [{ id: TENCENT_ID, presentation: PRESENTATION, snapshot: {
      status: 'connected', toolCount: 5, errorCode: null, errorMessage: null,
      updatedAt: '2026-08-25T00:00:01.000Z',
    } }] })
    expect(face.hooks.managedMcp.getSnapshot().connectors[0].connector).toMatchObject({
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
