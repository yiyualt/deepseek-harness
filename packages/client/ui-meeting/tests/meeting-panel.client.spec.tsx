// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MeetingPanelState } from '../src/client/controller.ts'
import { MeetingPanel } from '../src/client/MeetingPanel.tsx'
import { en } from '../src/client/locales.ts'

const BASE: MeetingPanelState = {
  open: true,
  draft: 'https://meet.google.com/abc-defg-hij',
  pending: null,
  error: null,
  presence: {
    status: 'idle',
    meetingUrl: null,
    provider: null,
    botName: 'DeepSeek AI 会议助手',
    errorCode: null,
    errorMessage: null,
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
}

function renderPanel(state: MeetingPanelState, actions: {
  open?: () => void
  close?: () => void
  setDraft?: (value: string) => void
  join?: () => Promise<void>
  leave?: () => Promise<void>
} = {}) {
  return render(<MeetingPanel
    wide={true}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useMeeting={selector => selector(state)}
    open={actions.open ?? vi.fn()}
    close={actions.close ?? vi.fn()}
    setDraft={actions.setDraft ?? vi.fn()}
    join={actions.join ?? vi.fn(async () => {})}
    leave={actions.leave ?? vi.fn(async () => {})}
    t={((key: keyof typeof en): string => en[key]) as never}
  />)
}

describe('MeetingPanel', () => {
  it('renders the sidebar action and submits a meeting link', () => {
    const join = vi.fn(async () => {})
    const setDraft = vi.fn()
    renderPanel(BASE, { join, setDraft })
    expect(screen.getByRole('button', { name: en.trigger })).toBeTruthy()
    const input = screen.getByLabelText(en.urlLabel)
    fireEvent.change(input, { target: { value: 'https://meet.google.com/xyz-abcd-efg' } })
    expect(setDraft).toHaveBeenCalledWith('https://meet.google.com/xyz-abcd-efg')
    fireEvent.submit(screen.getByRole('button', { name: en.join }).closest('form')!)
    expect(join).toHaveBeenCalledOnce()
  })

  it('shows the admission instruction and routes leave without hiding the bot name', () => {
    const leave = vi.fn(async () => {})
    renderPanel({
      ...BASE,
      presence: {
        ...BASE.presence,
        status: 'waiting-admission',
        meetingUrl: BASE.draft,
        provider: 'google-meet',
      },
    }, { leave })
    expect(screen.getByText(en.waitingAdmission)).toBeTruthy()
    expect(screen.getByText(en.waitingHint)).toBeTruthy()
    expect(screen.getByText('DeepSeek AI 会议助手')).toBeTruthy()
    expect(screen.getByText('Google Meet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.leave }))
    expect(leave).toHaveBeenCalledOnce()
  })

  it('closes from Escape and presents a Host failure', () => {
    const close = vi.fn()
    renderPanel({
      ...BASE,
      error: 'Chrome was unavailable',
      presence: { ...BASE.presence, status: 'failed' },
    }, { close })
    expect(screen.getByRole('alert').textContent).toBe('Chrome was unavailable')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
})
