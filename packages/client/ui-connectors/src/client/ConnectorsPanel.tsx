/** Sidebar trigger and modal for external service connectors. */

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  KingsoftDocsConnectorStatus,
  TencentDocsConnectorStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconLinkOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  CONNECTOR_REQUEST_FAILED,
  type BrowserLoginConnectorState,
  type ConnectorsPanelState,
} from './controller.ts'
import type { ConnectorKey } from './locales.ts'
import css from './ConnectorsPanel.module.css'

/** Document connectors rendered by this panel. */
export type ConnectorId = 'tencentDocs' | 'kingsoftDocs'

type ConnectorStatus = TencentDocsConnectorStatus | KingsoftDocsConnectorStatus

const TENCENT_ERRORS: Readonly<Record<string, ConnectorKey>> = {
  CREDENTIAL_MISSING: 'errorCredentialMissing',
  CREDENTIAL_LOOKUP_FAILED: 'errorCredentialLookup',
  AUTH_REJECTED: 'errorAuthRejected',
  CONNECTION_FAILED: 'errorConnectionFailed',
  CONNECTION_LOST: 'errorConnectionLost',
  DISCONNECT_FAILED: 'errorDisconnectFailed',
}

const KINGSOFT_ERRORS: Readonly<Record<string, ConnectorKey>> = {
  CLI_NOT_FOUND: 'kingsoftErrorCliNotFound',
  CLI_INCOMPATIBLE: 'kingsoftErrorCliIncompatible',
  LOGIN_FAILED: 'kingsoftErrorLoginFailed',
  LOGIN_TIMEOUT: 'kingsoftErrorLoginTimeout',
  AUTH_REJECTED: 'kingsoftErrorAuthRejected',
  DISCONNECT_FAILED: 'kingsoftErrorDisconnectFailed',
}

/** Registration-private controller face. */
export interface ConnectorsPanelInjected {
  hooks: {
    /** Tencent Docs Token card state. */
    tencentDocs: SnapshotStore<ConnectorsPanelState>
    /** Kingsoft Docs browser-login card state. */
    kingsoftDocs: SnapshotStore<BrowserLoginConnectorState>
  }
  open: () => void
  close: () => void
  setTencentDraft: (value: string) => void
  clearTencentDraft: () => void
  connect: (id: ConnectorId) => Promise<void>
  disconnect: (id: ConnectorId) => Promise<void>
}

/** Full sidebar action props. */
export type ConnectorsPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'connectors'>
  & InjectFace<ConnectorsPanelInjected>

function isBusy(state: { pending: 'connect' | 'disconnect' | null; connector: { status: ConnectorStatus } }): boolean {
  return state.pending !== null
    || ['connecting', 'reconnecting', 'disconnecting'].includes(state.connector.status)
}

function isConnected(status: ConnectorStatus): boolean {
  return status === 'connected' || status === 'reconnecting' || status === 'disconnecting'
}

function localizedError(
  state: { error: string | null; connector: { errorCode: string | null; errorMessage: string | null } },
  errors: Readonly<Record<string, ConnectorKey>>,
  t: ConnectorsPanelProps['t'],
): string | null {
  if (state.error !== null) return state.error
  if (state.connector.errorCode === null) return state.connector.errorMessage
  if (state.connector.errorCode === CONNECTOR_REQUEST_FAILED) return t('errorRequestFailed')
  const key = errors[state.connector.errorCode]
  return key === undefined ? state.connector.errorMessage : t(key)
}

interface CardFrameProps {
  readonly id: ConnectorId
  readonly logo: string
  readonly logoClass: string | undefined
  readonly name: string
  readonly description: string
  readonly status: ConnectorStatus
  readonly busy: boolean
  readonly toolCount: number
  readonly error: string | null
  readonly t: ConnectorsPanelProps['t']
  readonly children: ReactNode
}

function CardFrame(props: CardFrameProps) {
  return (
    <article className={css.card} data-connector-id={props.id}>
      <div className={css.cardHeader}>
        <div className={css.identity}>
          <span className={clsx(css.logo, props.logoClass)} aria-hidden="true">{props.logo}</span>
          <div>
            <h3 className={css.cardTitle}>{props.name}</h3>
            <p className={css.cardDescription}>{props.description}</p>
          </div>
        </div>
        <span className={clsx(css.badge, css[`badge-${props.status}`])}>
          {props.busy && <IconLoadingOutline16 className={css.spinner} size={14} />}
          {props.t(props.status)}
        </span>
      </div>
      {props.status === 'connected' && (
        <p className={css.tools} aria-live="polite">
          {props.t('toolsPrefix')} <strong>{props.toolCount}</strong> {props.t('toolsSuffix')}
        </p>
      )}
      {props.children}
      {props.error !== null && <p className={css.error} role="alert">{props.error}</p>}
    </article>
  )
}

interface TencentCardProps {
  readonly state: ConnectorsPanelState
  readonly setDraft: (value: string) => void
  readonly clearDraft: () => void
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly t: ConnectorsPanelProps['t']
}

function TencentDocsCard({ state, setDraft, clearDraft, connect, disconnect, t }: TencentCardProps) {
  const inputId = useId()
  const status = state.connector.status
  const busy = isBusy(state)
  const connected = isConnected(status)
  const credentialEditable = state.loopback && state.connector.credentialWritable && !connected
  const canConnect = state.loopback
    && !busy
    && !connected
    && (state.draft.trim() !== '' || state.connector.credentialConfigured)

  return (
    <CardFrame
      id="tencentDocs"
      logo="文"
      logoClass={undefined}
      name={t('tencentDocsName')}
      description={t('tencentDocsDescription')}
      status={status}
      busy={busy}
      toolCount={state.connector.toolCount}
      error={localizedError(state, TENCENT_ERRORS, t)}
      t={t}
    >
      {state.loopback && (
        <div className={css.credential}>
          <label className={css.label} htmlFor={inputId}>{t('tokenLabel')}</label>
          <div className={css.inputRow}>
            <input
              id={inputId}
              className={css.input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={state.draft}
              placeholder={state.connector.credentialConfigured
                ? t('tokenConfiguredPlaceholder')
                : t('tokenPlaceholder')}
              disabled={!credentialEditable || busy}
              onChange={(event) => { setDraft(event.currentTarget.value) }}
            />
            {state.draft !== '' && (
              <button type="button" className={css.clear} onClick={clearDraft}>{t('clearToken')}</button>
            )}
          </div>
          <div className={css.credentialMeta}>
            <span>{state.connector.credentialConfigured ? t('tokenConfigured') : t('tokenMissing')}</span>
            {state.connector.credentialSource !== null && (
              <span>{t('credentialSource')}: {state.connector.credentialSource}</span>
            )}
          </div>
          {!state.connector.credentialWritable && state.connector.credentialConfigured && (
            <p className={css.notice}><IconWarningOutline16 size={14} />{t('tokenReadOnly')}</p>
          )}
          <a className={css.tokenLink} href="https://docs.qq.com/open/document/mcp/get-token/" target="_blank" rel="noreferrer">
            {t('getToken')}
          </a>
        </div>
      )}
      {state.loopback && (
        <div className={css.actions}>
          {connected
            ? (
              <button type="button" className={css.secondary} disabled={busy} onClick={() => { void disconnect() }}>
                {busy ? t('working') : state.connector.credentialWritable ? t('disconnect') : t('disconnectKeepToken')}
              </button>
            )
            : (
              <button type="button" className={css.primary} disabled={!canConnect} onClick={() => { void connect() }}>
                {busy ? t('working') : status === 'failed' ? t('retry') : t('connect')}
              </button>
            )}
        </div>
      )}
    </CardFrame>
  )
}

interface KingsoftCardProps {
  readonly state: BrowserLoginConnectorState
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly t: ConnectorsPanelProps['t']
}

function KingsoftDocsCard({ state, connect, disconnect, t }: KingsoftCardProps) {
  const status = state.connector.status
  const busy = isBusy(state)
  const connected = isConnected(status)

  return (
    <CardFrame
      id="kingsoftDocs"
      logo="W"
      logoClass={css.logoKingsoft}
      name={t('kingsoftDocsName')}
      description={t('kingsoftDocsDescription')}
      status={status}
      busy={busy}
      toolCount={state.connector.toolCount}
      error={localizedError(state, KINGSOFT_ERRORS, t)}
      t={t}
    >
      {state.loopback && (
        <div className={css.credential}>
          <p className={css.notice}>{t('kingsoftLoginExplanation')}</p>
          <p className={css.credentialMeta}>{t('kingsoftCredentialStorage')}</p>
          <a
            className={css.tokenLink}
            href="https://github.com/kdocs-app/kdocs-skill/blob/master/references/auth.md"
            target="_blank"
            rel="noreferrer"
          >
            {t('kingsoftAuthHelp')}
          </a>
        </div>
      )}
      {state.loopback && (
        <div className={css.actions}>
          {connected
            ? (
              <button type="button" className={css.secondary} disabled={busy} onClick={() => { void disconnect() }}>
                {busy ? t('working') : t('kingsoftLogout')}
              </button>
            )
            : (
              <button type="button" className={css.primary} disabled={busy} onClick={() => { void connect() }}>
                {busy ? t('working') : status === 'failed' ? t('kingsoftRetryLogin') : t('kingsoftWebLogin')}
              </button>
            )}
        </div>
      )}
    </CardFrame>
  )
}

/** Render the connectors trigger and its full-viewport panel. */
export function ConnectorsPanel({
  wide,
  useTencentDocs,
  useKingsoftDocs,
  open,
  close,
  setTencentDraft,
  clearTencentDraft,
  connect,
  disconnect,
  t,
}: ConnectorsPanelProps) {
  const tencentDocs = useTencentDocs(value => value)
  const kingsoftDocs = useKingsoftDocs(value => value)
  const panelOpen = tencentDocs.open || kingsoftDocs.open
  const active = [tencentDocs.connector.status, kingsoftDocs.connector.status]
    .some(status => isConnected(status) || status === 'connecting')

  return (
    <>
      <button
        aria-label={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        className={clsx(css.trigger, !wide && css.rail)}
        onClick={open}
        type="button"
      >
        <IconLinkOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
        {active && <span className={css.activeDot} aria-hidden="true" />}
      </button>
      <Modal
        open={panelOpen}
        onClose={close}
        title={t('title')}
        closeLabel={t('close')}
        description={t('description')}
        className={css.panel as string}
      >
        <div className={css.cards}>
          <TencentDocsCard
            state={tencentDocs}
            setDraft={setTencentDraft}
            clearDraft={clearTencentDraft}
            connect={() => connect('tencentDocs')}
            disconnect={() => disconnect('tencentDocs')}
            t={t}
          />
          <KingsoftDocsCard
            state={kingsoftDocs}
            connect={() => connect('kingsoftDocs')}
            disconnect={() => disconnect('kingsoftDocs')}
            t={t}
          />
        </div>
        {!tencentDocs.loopback && (
          <p className={css.readOnly}><IconWarningOutline16 size={16} />{t('readOnly')}</p>
        )}
      </Modal>
    </>
  )
}
