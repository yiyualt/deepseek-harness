// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BrowserLoginConnectorState,
  ConnectorsPanelState,
  ManagedMcpConnectorsState,
  QqMailConnectorState,
} from '../src/client/controller.ts'
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

const KINGSOFT_BASE: BrowserLoginConnectorState = {
  open: true,
  pending: null,
  error: null,
  loopback: true,
  connector: {
    status: 'disconnected',
    toolCount: 0,
    errorCode: null,
    errorMessage: null,
    updatedAt: '2026-08-26T00:00:00.000Z',
  },
}

const QQ_MAIL_BASE: QqMailConnectorState = {
  open: true,
  emailDraft: '',
  authorizationCodeDraft: '',
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
    updatedAt: '2026-08-26T00:00:00.000Z',
  },
}

const TENCENT_ID = 'tencent-docs' as never

function managedState(state: ConnectorsPanelState): ManagedMcpConnectorsState {
  return {
    open: state.open,
    loopback: state.loopback,
    error: null,
    connectors: [{
      id: TENCENT_ID,
      presentation: {
        logo: '文',
        name: { zh: zh.tencentDocsName, en: en.tencentDocsName },
        description: { zh: zh.tencentDocsDescription, en: en.tencentDocsDescription },
        credentialName: { zh: zh.tokenLabel, en: en.tokenLabel },
        credentialHelpUrl: 'https://docs.qq.com/open/document/mcp/get-token/',
        credentialHelpLabel: { zh: zh.getToken, en: en.getToken },
      },
      credentialRef: 'TENCENT_DOCS_MCP_TOKEN',
      connector: state.connector,
      draft: state.draft,
      pending: state.pending,
      error: state.error,
    }],
  }
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
  const kingsoftState = { ...KINGSOFT_BASE, open: state.open, loopback: false }
  return render(<ConnectorsPanel
    wide={wide}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useManagedMcp={selector => selector(managedState(state))}
    useKingsoftDocs={selector => selector(kingsoftState)}
    useQqMail={selector => selector({ ...QQ_MAIL_BASE, open: state.open, loopback: false })}
    open={actions.open ?? vi.fn()}
    close={actions.close ?? vi.fn()}
    setManagedDraft={(_, value) => {
      if (value === '') actions.clearDraft?.()
      else actions.setDraft?.(value)
    }}
    setQqMailDraft={vi.fn()}
    connect={async (id) => { if (id === TENCENT_ID) await actions.connect?.() }}
    disconnect={async (id) => { if (id === TENCENT_ID) await actions.disconnect?.() }}
    t={((key: keyof typeof en): string => en[key]) as never}
  />)
}

function renderPanelWithCopy(
  state: ConnectorsPanelState,
  copy: Record<keyof typeof en, string>,
) {
  const kingsoftState = { ...KINGSOFT_BASE, open: state.open, loopback: false }
  return render(<ConnectorsPanel
    wide={true}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useManagedMcp={selector => selector(managedState(state))}
    useKingsoftDocs={selector => selector(kingsoftState)}
    useQqMail={selector => selector({ ...QQ_MAIL_BASE, open: state.open, loopback: false })}
    open={vi.fn()}
    close={vi.fn()}
    setManagedDraft={vi.fn()}
    setQqMailDraft={vi.fn()}
    connect={vi.fn(async () => {})}
    disconnect={vi.fn(async () => {})}
    t={((key: keyof typeof en): string => copy[key]) as never}
  />)
}

function renderKingsoftPanel(
  state: BrowserLoginConnectorState,
  actions: {
    connect?: () => Promise<void>
    disconnect?: () => Promise<void>
  } = {},
) {
  const tencentState = { ...BASE, open: state.open, loopback: false }
  return render(<ConnectorsPanel
    wide={true}
    useSessions={(() => undefined) as never}
    useWorkspaces={(() => undefined) as never}
    useManagedMcp={selector => selector(managedState(tencentState))}
    useKingsoftDocs={selector => selector(state)}
    useQqMail={selector => selector({ ...QQ_MAIL_BASE, open: state.open, loopback: false })}
    open={vi.fn()}
    close={vi.fn()}
    setManagedDraft={vi.fn()}
    setQqMailDraft={vi.fn()}
    connect={async (id) => { if (id === 'kingsoftDocs') await actions.connect?.() }}
    disconnect={async (id) => { if (id === 'kingsoftDocs') await actions.disconnect?.() }}
    t={((key: keyof typeof en): string => en[key]) as never}
  />)
}

describe('ConnectorsPanel', () => {
  it('renders another hosted MCP provider from catalog data without a provider-specific component', () => {
    const state = managedState(BASE)
    const mailId = 'mail-demo' as never
    const mail = {
      ...state.connectors[0]!,
      id: mailId,
      credentialRef: 'MAIL_DEMO_TOKEN',
      presentation: {
        logo: '邮',
        name: { zh: '邮箱示例', en: 'Mail Demo' },
        description: { zh: '邮件工具', en: 'Mail tools' },
        credentialName: { zh: '访问令牌', en: 'Access Token' },
        credentialHelpUrl: 'https://mail.example.test/token',
        credentialHelpLabel: { zh: '获取令牌', en: 'Get mail Token' },
      },
    }
    render(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useManagedMcp={selector => selector({ ...state, connectors: [...state.connectors, mail] })}
      useKingsoftDocs={selector => selector({ ...KINGSOFT_BASE, loopback: false })}
      useQqMail={selector => selector({ ...QQ_MAIL_BASE, loopback: false })}
      open={vi.fn()}
      close={vi.fn()}
      setManagedDraft={vi.fn()}
      setQqMailDraft={vi.fn()}
      connect={vi.fn(async () => {})}
      disconnect={vi.fn(async () => {})}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)

    const card = document.querySelector('[data-connector-id="mail-demo"]')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText('Mail Demo')).toBeTruthy()
    expect(within(card as HTMLElement).getByLabelText('Access Token')).toBeTruthy()
    expect(within(card as HTMLElement).getByRole('link', { name: 'Get mail Token' })).toBeTruthy()
  })

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

  it('renders an independent Kingsoft Docs browser-login card without a Token field', () => {
    const connect = vi.fn(async () => {})
    const tencentState = { ...BASE, loopback: false }
    const kingsoftState = KINGSOFT_BASE
    render(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useManagedMcp={selector => selector(managedState(tencentState))}
      useKingsoftDocs={selector => selector(kingsoftState)}
      useQqMail={selector => selector({ ...QQ_MAIL_BASE, loopback: false })}
      open={vi.fn()}
      close={vi.fn()}
      setManagedDraft={vi.fn()}
      setQqMailDraft={vi.fn()}
      connect={connect}
      disconnect={vi.fn(async () => {})}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)
    const card = document.querySelector('[data-connector-id="kingsoftDocs"]')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText(en.kingsoftDocsName)).toBeTruthy()
    expect(within(card as HTMLElement).queryByRole('textbox')).toBeNull()
    expect(within(card as HTMLElement).getByText(en.kingsoftCredentialStorage)).toBeTruthy()
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: en.kingsoftWebLogin }))
    expect(connect).toHaveBeenCalledWith('kingsoftDocs')
    expect(within(card as HTMLElement).getByRole('link', { name: en.kingsoftAuthHelp }).getAttribute('href'))
      .toBe('https://github.com/kdocs-app/kdocs-skill/blob/master/references/auth.md')
  })

  it('collects a personal QQ Mail address and authorization code', () => {
    const connect = vi.fn(async () => {})
    const setDraft = vi.fn()
    const tencentState = { ...BASE, loopback: false }
    render(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useManagedMcp={selector => selector(managedState(tencentState))}
      useKingsoftDocs={selector => selector({ ...KINGSOFT_BASE, loopback: false })}
      useQqMail={selector => selector({
        ...QQ_MAIL_BASE,
        emailDraft: 'user@qq.com',
        authorizationCodeDraft: 'authorization-code',
      })}
      open={vi.fn()}
      close={vi.fn()}
      setManagedDraft={vi.fn()}
      setQqMailDraft={setDraft}
      connect={connect}
      disconnect={vi.fn(async () => {})}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)

    const card = document.querySelector('[data-connector-id="qqMail"]')
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText(en.qqMailName)).toBeTruthy()
    const email = within(card as HTMLElement).getByLabelText(en.qqMailEmailLabel)
    const code = within(card as HTMLElement).getByLabelText(en.qqMailAuthorizationCodeLabel)
    expect(email.getAttribute('type')).toBe('email')
    expect(code.getAttribute('type')).toBe('password')
    fireEvent.change(email, { target: { value: 'next@qq.com' } })
    fireEvent.change(code, { target: { value: 'next-code' } })
    expect(setDraft).toHaveBeenCalledWith('email', 'next@qq.com')
    expect(setDraft).toHaveBeenCalledWith('authorizationCode', 'next-code')
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: en.connect }))
    expect(connect).toHaveBeenCalledWith('qqMail')
    expect(within(card as HTMLElement).getByRole('link', { name: en.qqMailOpenSettings }).getAttribute('href'))
      .toBe('https://mail.qq.com/')
  })

  it('routes QQ Mail logout from its connected card', () => {
    const disconnect = vi.fn(async () => {})
    const tencentState = { ...BASE, loopback: false }
    const connected = {
      ...QQ_MAIL_BASE,
      connector: { ...QQ_MAIL_BASE.connector, status: 'connected' as const, toolCount: 4 },
    }
    render(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useManagedMcp={selector => selector(managedState(tencentState))}
      useKingsoftDocs={selector => selector({ ...KINGSOFT_BASE, loopback: false })}
      useQqMail={selector => selector(connected)}
      open={vi.fn()}
      close={vi.fn()}
      setManagedDraft={vi.fn()}
      setQqMailDraft={vi.fn()}
      connect={vi.fn(async () => {})}
      disconnect={disconnect}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)
    const card = document.querySelector('[data-connector-id="qqMail"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: en.qqMailDisconnect }))
    expect(disconnect).toHaveBeenCalledWith('qqMail')
  })

  it('renders QQ Mail retry and busy actions', () => {
    const tencentState = { ...BASE, loopback: false }
    const renderQq = (state: QqMailConnectorState) => render(<ConnectorsPanel
      wide={true}
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useManagedMcp={selector => selector(managedState(tencentState))}
      useKingsoftDocs={selector => selector({ ...KINGSOFT_BASE, loopback: false })}
      useQqMail={selector => selector(state)}
      open={vi.fn()}
      close={vi.fn()}
      setManagedDraft={vi.fn()}
      setQqMailDraft={vi.fn()}
      connect={vi.fn(async () => {})}
      disconnect={vi.fn(async () => {})}
      t={((key: keyof typeof en): string => en[key]) as never}
    />)

    renderQq({ ...QQ_MAIL_BASE, pending: 'connect' })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
    cleanup()
    renderQq({
      ...QQ_MAIL_BASE,
      pending: 'disconnect',
      connector: { ...QQ_MAIL_BASE.connector, status: 'connected', credentialConfigured: true, toolCount: 4 },
    })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)
    cleanup()
    renderQq({
      ...QQ_MAIL_BASE,
      connector: { ...QQ_MAIL_BASE.connector, status: 'failed', credentialConfigured: true, errorCode: 'AUTH_REJECTED' },
    })
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
  })

  it('renders Kingsoft logout, retry, and busy browser-login actions', () => {
    const disconnect = vi.fn(async () => {})
    renderKingsoftPanel({
      ...KINGSOFT_BASE,
      connector: { ...KINGSOFT_BASE.connector, status: 'connected', toolCount: 2 },
    }, { disconnect })
    fireEvent.click(screen.getByRole('button', { name: en.kingsoftLogout }))
    expect(disconnect).toHaveBeenCalledOnce()

    cleanup()
    renderKingsoftPanel({
      ...KINGSOFT_BASE,
      pending: 'disconnect',
      connector: { ...KINGSOFT_BASE.connector, status: 'connected', toolCount: 2 },
    })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)

    cleanup()
    renderKingsoftPanel({ ...KINGSOFT_BASE, pending: 'connect' })
    expect(screen.getByRole('button', { name: en.working }).hasAttribute('disabled')).toBe(true)

    cleanup()
    const retry = vi.fn(async () => {})
    renderKingsoftPanel({
      ...KINGSOFT_BASE,
      connector: { ...KINGSOFT_BASE.connector, status: 'failed', errorCode: 'LOGIN_FAILED' },
    }, { connect: retry })
    fireEvent.click(screen.getByRole('button', { name: en.kingsoftRetryLogin }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('clears the draft explicitly and renders configured credential metadata without a value', () => {
    const clearDraft = vi.fn()
    renderPanel({
      ...BASE,
      draft: 'browser-only-draft',
      connector: { ...BASE.connector, credentialConfigured: true, credentialSource: 'file' },
    }, { clearDraft })
    expect(screen.getByText(en.tokenConfigured.replace('{credential}', en.tokenLabel))).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', {
      name: en.disconnect.replace('{credential}', en.tokenLabel),
    }))
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('preserves an unknown localization placeholder while replacing known values', () => {
    renderPanelWithCopy({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'connected',
        credentialConfigured: true,
        credentialSource: 'file',
      },
    }, { ...en, disconnect: 'Remove {credential} from {unknown}' })
    expect(screen.getByRole('button', { name: `Remove ${en.tokenLabel} from {unknown}` })).toBeTruthy()
  })

  it('keeps a read-only credential on disconnect and presents retry failures', () => {
    const disconnect = vi.fn(async () => {})
    renderPanel({
      ...BASE,
      connector: {
        ...BASE.connector,
        status: 'connected',
        credentialConfigured: true,
        credentialSource: 'env',
        credentialWritable: false,
      },
    }, { disconnect })
    expect(screen.getByText(en.tokenReadOnly.replace('{credential}', en.tokenLabel))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.disconnectKeepToken }))
    expect(disconnect).toHaveBeenCalledOnce()

    cleanup()
    renderPanel({
      ...BASE,
      error: 'Token refused',
      connector: { ...BASE.connector, status: 'failed', credentialConfigured: true },
    })
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
    expect(screen.getByRole('alert').textContent)
      .toBe(en.errorAuthRejected.replace('{name}', en.tencentDocsName))
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
