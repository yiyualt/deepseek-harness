/** Sidebar trigger and modal for external service connectors. */

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  KingsoftDocsConnectorStatus,
  McpConnectorId,
  McpConnectorStatus,
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
  type ManagedMcpConnectorCardState,
  type ManagedMcpConnectorsState,
  type QqMailConnectorState,
} from './controller.ts'
import type { ConnectorKey } from './locales.ts'
import css from './ConnectorsPanel.module.css'

/** Document connectors rendered by this panel. */
export type ConnectorId = McpConnectorId | 'kingsoftDocs' | 'qqMail'

type ConnectorStatus = McpConnectorStatus | KingsoftDocsConnectorStatus

const MCP_ERRORS: Readonly<Record<string, ConnectorKey>> = {
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

const QQ_MAIL_ERRORS: Readonly<Record<string, ConnectorKey>> = {
  CREDENTIAL_MISSING: 'qqMailErrorCredentialMissing',
  AUTH_REJECTED: 'qqMailErrorAuthRejected',
  CONNECTION_FAILED: 'qqMailErrorConnectionFailed',
}

/** Registration-private controller face. */
export interface ConnectorsPanelInjected {
  hooks: {
    /** Declaratively configured hosted MCP card state. */
    managedMcp: SnapshotStore<ManagedMcpConnectorsState>
    /** Kingsoft Docs browser-login card state. */
    kingsoftDocs: SnapshotStore<BrowserLoginConnectorState>
    /** Personal QQ Mail credential card state. */
    qqMail: SnapshotStore<QqMailConnectorState>
  }
  open: () => void
  close: () => void
  setManagedDraft: (id: McpConnectorId, value: string) => void
  setQqMailDraft: (field: 'email' | 'authorizationCode', value: string) => void
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

interface ManagedMcpCardProps {
  readonly state: ManagedMcpConnectorCardState
  readonly loopback: boolean
  readonly setDraft: (value: string) => void
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly t: ConnectorsPanelProps['t']
}

function replace(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
}

function ManagedMcpCard({ state, loopback, setDraft, connect, disconnect, t }: ManagedMcpCardProps) {
  const inputId = useId()
  const status = state.connector.status
  const busy = isBusy(state)
  const connected = isConnected(status)
  const locale = t('providerLocale') === 'zh' ? 'zh' : 'en'
  const name = state.presentation.name[locale]
  const credentialName = state.presentation.credentialName[locale]
  const translatedError = localizedError(state, MCP_ERRORS, t)
  const credentialEditable = loopback && state.connector.credentialWritable && !connected
  const canConnect = loopback
    && !busy
    && !connected
    && (state.draft.trim() !== '' || state.connector.credentialConfigured)

  return (
    <CardFrame
      id={state.id}
      logo={state.presentation.logo}
      logoClass={undefined}
      name={name}
      description={state.presentation.description[locale]}
      status={status}
      busy={busy}
      toolCount={state.connector.toolCount}
      error={translatedError === null
        ? null
        : replace(translatedError, { name, credential: credentialName })}
      t={t}
    >
      {loopback && (
        <div className={css.credential}>
          <label className={css.label} htmlFor={inputId}>{credentialName}</label>
          <div className={css.inputRow}>
            <input
              id={inputId}
              className={css.input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={state.draft}
              placeholder={replace(state.connector.credentialConfigured
                ? t('tokenConfiguredPlaceholder')
                : t('tokenPlaceholder'), { credential: credentialName })}
              disabled={!credentialEditable || busy}
              onChange={(event) => { setDraft(event.currentTarget.value) }}
            />
            {state.draft !== '' && (
              <button type="button" className={css.clear} onClick={() => { setDraft('') }}>{t('clearToken')}</button>
            )}
          </div>
          <div className={css.credentialMeta}>
            <span>{replace(state.connector.credentialConfigured ? t('tokenConfigured') : t('tokenMissing'), {
              credential: credentialName,
            })}</span>
            {state.connector.credentialSource !== null && (
              <span>{t('credentialSource')}: {state.connector.credentialSource}</span>
            )}
          </div>
          {!state.connector.credentialWritable && state.connector.credentialConfigured && (
            <p className={css.notice}><IconWarningOutline16 size={14} />{replace(t('tokenReadOnly'), {
              credential: credentialName,
            })}</p>
          )}
          <a className={css.tokenLink} href={state.presentation.credentialHelpUrl} target="_blank" rel="noreferrer">
            {state.presentation.credentialHelpLabel[locale]}
          </a>
        </div>
      )}
      {loopback && (
        <div className={css.actions}>
          {connected
            ? (
              <button type="button" className={css.secondary} disabled={busy} onClick={() => { void disconnect() }}>
                {busy ? t('working') : state.connector.credentialWritable
                  ? replace(t('disconnect'), { credential: credentialName })
                  : t('disconnectKeepToken')}
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

interface BrowserLoginCardProps {
  readonly id: 'kingsoftDocs'
  readonly logo: string
  readonly logoClass: string | undefined
  readonly nameKey: ConnectorKey
  readonly descriptionKey: ConnectorKey
  readonly loginExplanationKey: ConnectorKey
  readonly credentialStorageKey: ConnectorKey
  readonly authHelpKey: ConnectorKey
  readonly authHelpUrl: string
  readonly loginKey: ConnectorKey
  readonly retryKey: ConnectorKey
  readonly logoutKey: ConnectorKey
  readonly errors: Readonly<Record<string, ConnectorKey>>
  readonly state: BrowserLoginConnectorState
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly t: ConnectorsPanelProps['t']
}

function BrowserLoginCard({
  id, logo, logoClass, nameKey, descriptionKey, loginExplanationKey, credentialStorageKey,
  authHelpKey, authHelpUrl, loginKey, retryKey, logoutKey, errors, state, connect, disconnect, t,
}: BrowserLoginCardProps) {
  const status = state.connector.status
  const busy = isBusy(state)
  const connected = isConnected(status)

  return (
    <CardFrame
      id={id}
      logo={logo}
      logoClass={logoClass}
      name={t(nameKey)}
      description={t(descriptionKey)}
      status={status}
      busy={busy}
      toolCount={state.connector.toolCount}
      error={localizedError(state, errors, t)}
      t={t}
    >
      {state.loopback && (
        <div className={css.credential}>
          <p className={css.notice}>{t(loginExplanationKey)}</p>
          <p className={css.credentialMeta}>{t(credentialStorageKey)}</p>
          <a
            className={css.tokenLink}
            href={authHelpUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t(authHelpKey)}
          </a>
        </div>
      )}
      {state.loopback && (
        <div className={css.actions}>
          {connected
            ? (
              <button type="button" className={css.secondary} disabled={busy} onClick={() => { void disconnect() }}>
                {busy ? t('working') : t(logoutKey)}
              </button>
            )
            : (
              <button type="button" className={css.primary} disabled={busy} onClick={() => { void connect() }}>
                {busy ? t('working') : status === 'failed' ? t(retryKey) : t(loginKey)}
              </button>
            )}
        </div>
      )}
    </CardFrame>
  )
}

interface QqMailCardProps {
  readonly state: QqMailConnectorState
  readonly setDraft: (field: 'email' | 'authorizationCode', value: string) => void
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly t: ConnectorsPanelProps['t']
}

function QqMailCard({ state, setDraft, connect, disconnect, t }: QqMailCardProps) {
  const emailId = useId()
  const codeId = useId()
  const status = state.connector.status
  const busy = isBusy(state)
  const connected = isConnected(status)
  const editable = state.loopback && state.connector.credentialWritable && !connected
  const canConnect = state.loopback && !busy && !connected && (
    state.connector.credentialConfigured
    || (state.emailDraft.trim() !== '' && state.authorizationCodeDraft.trim() !== '')
  )

  return (
    <CardFrame
      id="qqMail"
      logo="邮"
      logoClass={undefined}
      name={t('qqMailName')}
      description={t('qqMailDescription')}
      status={status}
      busy={busy}
      toolCount={state.connector.toolCount}
      error={localizedError(state, QQ_MAIL_ERRORS, t)}
      t={t}
    >
      {state.loopback && (
        <div className={css.credential}>
          <label className={css.label} htmlFor={emailId}>{t('qqMailEmailLabel')}</label>
          <div className={css.inputRow}>
            <input
              id={emailId}
              className={css.input}
              type="email"
              autoComplete="username"
              spellCheck={false}
              value={state.emailDraft}
              placeholder={state.connector.credentialConfigured ? t('qqMailConfiguredPlaceholder') : 'example@qq.com'}
              disabled={!editable || busy}
              onChange={(event) => { setDraft('email', event.currentTarget.value) }}
            />
          </div>
          <label className={css.label} htmlFor={codeId}>{t('qqMailAuthorizationCodeLabel')}</label>
          <div className={css.inputRow}>
            <input
              id={codeId}
              className={css.input}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={state.authorizationCodeDraft}
              placeholder={state.connector.credentialConfigured
                ? t('qqMailConfiguredPlaceholder')
                : t('qqMailAuthorizationCodePlaceholder')}
              disabled={!editable || busy}
              onChange={(event) => { setDraft('authorizationCode', event.currentTarget.value) }}
            />
          </div>
          <p className={css.notice}>{t('qqMailAuthorizationHelp')}</p>
          <p className={css.credentialMeta}>{t('qqMailCredentialStorage')}</p>
          <a className={css.tokenLink} href="https://mail.qq.com/" target="_blank" rel="noreferrer">
            {t('qqMailOpenSettings')}
          </a>
        </div>
      )}
      {state.loopback && (
        <div className={css.actions}>
          {connected
            ? (
              <button type="button" className={css.secondary} disabled={busy} onClick={() => { void disconnect() }}>
                {busy ? t('working') : t('qqMailDisconnect')}
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

/** Render the connectors trigger and its full-viewport panel. */
export function ConnectorsPanel({
  wide,
  useManagedMcp,
  useKingsoftDocs,
  useQqMail,
  open,
  close,
  setManagedDraft,
  setQqMailDraft,
  connect,
  disconnect,
  t,
}: ConnectorsPanelProps) {
  const managedMcp = useManagedMcp(value => value)
  const kingsoftDocs = useKingsoftDocs(value => value)
  const qqMail = useQqMail(value => value)
  const panelOpen = managedMcp.open || kingsoftDocs.open || qqMail.open
  const active = [
    ...managedMcp.connectors.map(connector => connector.connector.status),
    kingsoftDocs.connector.status,
    qqMail.connector.status,
  ]
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
          {managedMcp.connectors.map(connector => (
            <ManagedMcpCard
              key={connector.id}
              state={connector}
              loopback={managedMcp.loopback}
              setDraft={(value) => { setManagedDraft(connector.id, value) }}
              connect={() => connect(connector.id)}
              disconnect={() => disconnect(connector.id)}
              t={t}
            />
          ))}
          <BrowserLoginCard
            id="kingsoftDocs"
            logo="W"
            logoClass={css.logoKingsoft}
            nameKey="kingsoftDocsName"
            descriptionKey="kingsoftDocsDescription"
            loginExplanationKey="kingsoftLoginExplanation"
            credentialStorageKey="kingsoftCredentialStorage"
            authHelpKey="kingsoftAuthHelp"
            authHelpUrl="https://github.com/kdocs-app/kdocs-skill/blob/master/references/auth.md"
            loginKey="kingsoftWebLogin"
            retryKey="kingsoftRetryLogin"
            logoutKey="kingsoftLogout"
            errors={KINGSOFT_ERRORS}
            state={kingsoftDocs}
            connect={() => connect('kingsoftDocs')}
            disconnect={() => disconnect('kingsoftDocs')}
            t={t}
          />
          <QqMailCard
            state={qqMail}
            setDraft={setQqMailDraft}
            connect={() => connect('qqMail')}
            disconnect={() => disconnect('qqMail')}
            t={t}
          />
        </div>
        {!managedMcp.loopback && (
          <p className={css.readOnly}><IconWarningOutline16 size={16} />{t('readOnly')}</p>
        )}
      </Modal>
    </>
  )
}
