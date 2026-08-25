import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote, MeetingPresenceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { MeetingPanelController } from '../src/client/controller.ts'

const IDLE: MeetingPresenceSnapshot = {
  status: 'idle',
  meetingUrl: null,
  provider: null,
  botName: 'DeepSeek AI 会议助手',
  errorCode: null,
  errorMessage: null,
  updatedAt: '2026-08-18T00:00:00.000Z',
}

function remote(overrides: Partial<ClientRemote['meetingPresence']> = {}): ClientRemote {
  return {
    meetingPresence: {
      get: vi.fn(async () => ({ ok: true, value: IDLE })),
      join: vi.fn(async () => ({
        ok: true,
        value: { ok: true, snapshot: { ...IDLE, status: 'starting', meetingUrl: 'https://meet.google.com/abc-defg-hij', provider: 'google-meet' } },
      })),
      leave: vi.fn(async () => ({
        ok: true,
        value: { ok: true, snapshot: { ...IDLE, status: 'left' } },
      })),
      ...overrides,
    },
  } as unknown as ClientRemote
}

describe('MeetingPanelController', () => {
  it('opens with a Host reconciliation and routes join and leave mutations', async () => {
    const api = remote()
    const controller = new MeetingPanelController(api)
    controller.open()
    await vi.waitFor(() => { expect(api.meetingPresence.get).toHaveBeenCalledOnce() })
    controller.setDraft(' https://meet.google.com/abc-defg-hij ')
    await controller.join()
    expect(api.meetingPresence.join).toHaveBeenCalledWith('https://meet.google.com/abc-defg-hij')
    expect(controller.store.getSnapshot()).toMatchObject({
      open: true,
      pending: null,
      presence: { status: 'starting' },
    })
    await controller.leave()
    expect(controller.store.getSnapshot().presence.status).toBe('left')
    controller.close()
    expect(controller.store.getSnapshot().open).toBe(false)
  })

  it('publishes domain refusals and carrier failures as visible errors', async () => {
    const denied = remote({
      join: vi.fn(async () => ({
        ok: true as const,
        value: { ok: false as const, code: 'UNSUPPORTED_MEETING_URL', message: 'bad link', snapshot: IDLE },
      })),
      leave: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'offline', message: 'connection lost', details: {} },
      })),
    })
    const controller = new MeetingPanelController(denied)
    controller.setDraft('bad')
    await controller.join()
    expect(controller.store.getSnapshot().error).toBe('bad link')
    await controller.leave()
    expect(controller.store.getSnapshot().error).toBe('connection lost')
  })

  it('accepts pushed snapshots and ignores late work after disposal', async () => {
    let resolveGet: ((value: Awaited<ReturnType<ClientRemote['meetingPresence']['get']>>) => void) | undefined
    const api = remote({
      get: vi.fn(() => new Promise<Awaited<ReturnType<ClientRemote['meetingPresence']['get']>>>((resolve) => {
        resolveGet = resolve
      })),
    })
    const controller = new MeetingPanelController(api)
    controller.accept({ ...IDLE, status: 'joined' })
    expect(controller.store.getSnapshot().presence.status).toBe('joined')
    controller.open()
    controller.dispose()
    resolveGet?.({ ok: true, value: { ...IDLE, status: 'left' } })
    await Promise.resolve()
    expect(controller.store.getSnapshot().presence.status).toBe('joined')
  })
})
