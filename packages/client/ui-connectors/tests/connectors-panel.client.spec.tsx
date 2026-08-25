// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorsPanelState } from '../src/client/controller.ts'
import { CONNECTOR_REQUEST_FAILED } from '../src/client/controller.ts'
import { ConnectorsPanel } from '../src/client/ConnectorsPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

const BASE: ConnectorsPanelState = {
  open: true,
  draft: '',
  pending: null,
  error: null,
  loopback: true,
  connector: {
    status: 'disconnected',
    credentialConfigured: false,
    credentialSource: null,
    credentialWritable: true,
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: '2026-08-25T00:00:00.000Z',
  },
}

afterEach(cleanup)

function renderPanel(state: ConnectorsPanelState, actions: {
  open?: () => void
  close?: () => void
  setDraft?: (value: string) => void
  clearDraft?: () => void
  connect?: () => Promise<void>
  disconnect?: () => Promise<void>
} = {}, wide = true) {
  return render(<ConnectorsPanel
    wide={wide}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useConnectors={selector => selector(state)}
    open={actions.open ?? vi.fn()}
    close={actions.close ?? vi.fn()}
    setDraft={actions.setDraft ?? vi.fn()}
    clearDraft={actions.clearDraft ?? vi.fn()}
    connect={actions.connect ?? vi.fn(async () => {})}
    disconnect={actions.disconnect ?? vi.fn(async () => {})}
    t={((key: keyof typeof en): string => en[key]) as never}
  />)
}

function renderPanelWithCopy(
  state: ConnectorsPanelState,
  copy: Record<keyof typeof en, string>,
) {
  return render(<ConnectorsPanel
    wide={true}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useConnectors={selector => selector(state)}
    open={vi.fn()}
    close={vi.fn()}
    setDraft={vi.fn()}
    clearDraft={vi.fn()}
    connect={vi.fn(async () => {})}
    disconnect={vi.fn(async () => {})}
    t={((key: keyof typeof en): string => copy[key]) as never}
  />)
}

describe('ConnectorsPanel', () => {
  it('renders the Tencent Docs card and sends a typed Token through the connect action', () => {
    const setDraft = vi.fn()
    const connect = vi.fn(async () => {})
    renderPanel({ ...BASE, draft: 'new-token' }, { setDraft, connect })
    expect(screen.getByRole('button', { name: en.trigger })).toBeTruthy()
    expect(screen.getByText(en.tencentDocsName)).toBeTruthy()
    const input = screen.getByLabelText(en.tokenLabel)
    expect(input.getAttribute('type')).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    fireEvent.change(input, { target: { value: 'next-token' } })
    expect(setDraft).toHaveBeenCalledWith('next-token')
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    expect(connect).toHaveBeenCalledOnce()
    const link = screen.getByRole('link', { name: en.getToken })
    expect(link.getAttribute('href')).toBe('https://docs.qq.com/open/document/mcp/get-token/')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('clears the draft explicitly and renders configured credential metadata without a value', () => {
    const clearDraft = vi.fn()
    renderPanel({
      ...BASE,
      draft: 'browser-only-draft',
      connector: { ...BASE.connector, credentialConfigured: true, credentialSource: 'file' },
    }, { clearDraft })
    expect(screen.getByText(en.tokenConfigured)).toBeTruthy()
    expect(screen.getByText(`${en.credentialSource}: file`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.clearToken }))
    expect(clearDraft).toHaveBeenCalledOnce()
  })

  it('never renders a stored credential value into DOM content or accessibility attributes', () => {
    const storedSecret = 'server-side-secret-that-must-not-return'
    const { container } = renderPanel({
      ...BASE,
      connector: {
        ...BASE.connector,
        credentialConfigured: true,
        credentialSource: 'file',
      },
    })
    expect(container.innerHTML).not.toContain(storedSecret)
    expect(screen.getByLabelText(en.tokenLabel).getAttribute('value')).toBe('')
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(element.getAttribute(attribute)).not.toContain(storedSecret)
      }
    }
  })

  it('shows discovered tools and disconnects a writable connected credential', () => {
    const disconnect = vi.fn(async () => {})
    renderPanel({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'connected',
        credentialConfigured: true,
        credentialSource: 'file',
        toolCount: 7,
      },
    }, { disconnect })
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByLabelText(en.tokenLabel).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps a read-only credential on disconnect and presents retry failures', () => {
    const disconnect = vi.fn(async () => {})
    const { rerender } = renderPanel({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'connected',
        credentialConfigured: true,
        credentialSource: 'env',
        credentialWritable: false,
      },
    }, { disconnect })
    expect(screen.getByText(en.tokenReadOnly)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.disconnectKeepToken }))
    expect(disconnect).toHaveBeenCalledOnce()

    rerender(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useConnectors={selector => selector({
        ...BASE,
        error: 'Token refused',
        connector: { ...BASE.connector, status: 'failed', credentialConfigured: true },
      })}
      open={vi.fn()}
      close={vi.fn()}
      setDraft={vi.fn()}
      clearDraft={vi.fn()}
      connect={vi.fn(async () => {})}
      disconnect={vi.fn(async () => {})}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)
    expect(screen.getByRole('alert').textContent).toBe('Token refused')
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
  })

  it('localizes stable connector errors and uses Host messages only for unknown codes', () => {
    renderPanelWithCopy({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'failed',
        errorCode: 'AUTH_REJECTED',
        errorMessage: '腾讯文档拒绝了当前 Token，请更新后重试。',
      },
    }, en)
    expect(screen.getByRole('alert').textContent).toBe(en.errorAuthRejected)
    expect(screen.queryByText('腾讯文档拒绝了当前 Token，请更新后重试。')).toBeNull()

    cleanup()
    renderPanelWithCopy({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'failed',
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
      },
    }, zh)
    expect(screen.getByRole('alert').textContent).toBe(zh.errorRequestFailed)

    cleanup()
    renderPanelWithCopy({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'failed',
        errorCode: 'FUTURE_FAILURE',
        errorMessage: 'Future Host fallback',
      },
    }, en)
    expect(screen.getByRole('alert').textContent).toBe('Future Host fallback')
  })

  it('is view-only outside loopback and closes from Escape or the mask', () => {
    const close = vi.fn()
    renderPanel({ ...BASE, loopback: false }, { close })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.queryByLabelText(en.tokenLabel)).toBeNull()
    expect(screen.queryByRole('button', { name: en.connect })).toBeNull()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    fireEvent.click(document.querySelector('[aria-hidden="true"]')!)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('renders a compact rail trigger and busy connection status', () => {
    renderPanel({
      ...BASE,
      pending: 'connect',
      connector: { ...BASE.connector, status: 'connecting', credentialConfigured: true },
    }, {}, false)
    const trigger = screen.getByRole('button', { name: en.trigger })
    expect(trigger.textContent).toBe('')
    expect(screen.getByText(en.connecting)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
  })

  it('renders the trigger without mounting a closed panel', () => {
    const open = vi.fn()
    renderPanel({ ...BASE, open: false }, { open })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('shows the busy disconnect label while a connected connector is stopping', () => {
    renderPanel({
      ...BASE,
      pending: 'disconnect',
      connector: { ...BASE.connector, status: 'disconnecting', credentialConfigured: true },
    })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
  })
})
