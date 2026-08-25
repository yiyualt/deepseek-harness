/** Sidebar trigger and modal for external service connectors. */

import { useId } from 'react'
import clsx from 'clsx'
import type { TencentDocsConnectorStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconLinkOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CONNECTOR_REQUEST_FAILED, type ConnectorsPanelState } from './controller.ts'
import css from './ConnectorsPanel.module.css'

const TOKEN_URL = 'https://docs.qq.com/open/document/mcp/get-token/'

/** Registration-private controller face. */
export interface ConnectorsPanelInjected {
  hooks: {
    /** Complete panel state bound by the slot renderer as `useConnectors`. */
    connectors: SnapshotStore<ConnectorsPanelState>
  }
  open: () => void
  close: () => void
  setDraft: (value: string) => void
  clearDraft: () => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

/** Full sidebar action props. */
export type ConnectorsPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'connectors'>
  & InjectFace<ConnectorsPanelInjected>

function statusCopy(status: TencentDocsConnectorStatus): TencentDocsConnectorStatus {
  return status
}

const ERROR_COPY = {
  CREDENTIAL_MISSING: 'errorCredentialMissing',
  CREDENTIAL_LOOKUP_FAILED: 'errorCredentialLookup',
  AUTH_REJECTED: 'errorAuthRejected',
  CONNECTION_FAILED: 'errorConnectionFailed',
  CONNECTION_LOST: 'errorConnectionLost',
  DISCONNECT_FAILED: 'errorDisconnectFailed',
  [CONNECTOR_REQUEST_FAILED]: 'errorRequestFailed',
} as const

/** Render the connectors trigger and its full-viewport panel. */
export function ConnectorsPanel({
  wide,
  useConnectors,
  open,
  close,
  setDraft,
  clearDraft,
  connect,
  disconnect,
  t,
}: ConnectorsPanelProps) {
  const state = useConnectors(value => value)
  const titleId = useId()
  const status = state.connector.status
  const busy = state.pending !== null || ['connecting', 'reconnecting', 'disconnecting'].includes(status)
  const connected = status === 'connected' || status === 'reconnecting' || status === 'disconnecting'
  const active = connected || status === 'connecting'
  const errorKey = state.connector.errorCode === null
    ? undefined
    : ERROR_COPY[state.connector.errorCode as keyof typeof ERROR_COPY]
  const visibleError = state.error
    ?? (errorKey === undefined ? state.connector.errorMessage : t(errorKey))
  const credentialEditable = state.loopback && state.connector.credentialWritable && !connected
  const canConnect = state.loopback
    && !busy
    && !connected
    && (state.draft.trim() !== '' || state.connector.credentialConfigured)
  const triggerProps = {
    'aria-label': t('trigger'),
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': state.open,
    className: clsx(css.trigger, !wide && css.rail),
    onClick: open,
    type: 'button' as const,
  }

  return (
    <>
      <button {...triggerProps}>
        <IconLinkOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
        {active && <span className={css.activeDot} aria-hidden="true" />}
      </button>
      <Modal
        open={state.open}
        onClose={close}
        title={t('title')}
        closeLabel={t('close')}
        description={t('description')}
        className={css.panel as string}
      >
        <article className={css.card}>
          <div className={css.cardHeader}>
            <div className={css.identity}>
              <span className={css.logo} aria-hidden="true">文</span>
              <div>
                <h3 className={css.cardTitle}>{t('tencentDocsName')}</h3>
                <p className={css.cardDescription}>{t('tencentDocsDescription')}</p>
              </div>
            </div>
            <span className={clsx(css.badge, css[`badge-${status}`])}>
              {busy && <IconLoadingOutline16 className={css.spinner} size={14} />}
              {t(statusCopy(status))}
            </span>
          </div>

          {status === 'connected' && (
            <p className={css.tools} aria-live="polite">
              {t('toolsPrefix')} <strong>{state.connector.toolCount}</strong> {t('toolsSuffix')}
            </p>
          )}

          {state.loopback
            ? (
              <div className={css.credential}>
                <label className={css.label} htmlFor={`${titleId}-token`}>{t('tokenLabel')}</label>
                <div className={css.inputRow}>
                  <input
                    id={`${titleId}-token`}
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
                <a className={css.tokenLink} href={TOKEN_URL} target="_blank" rel="noreferrer">
                  {t('getToken')}
                </a>
              </div>
            )
            : <p className={css.readOnly}><IconWarningOutline16 size={16} />{t('readOnly')}</p>}

          {visibleError !== null && (
            <p className={css.error} role="alert">{visibleError}</p>
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
        </article>
      </Modal>
    </>
  )
}
