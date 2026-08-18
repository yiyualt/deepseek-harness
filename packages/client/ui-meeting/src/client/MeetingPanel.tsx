/** Sidebar trigger and modal for one presence-only meeting participant. */

import { useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCloseOutline16,
  IconLoadingOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MeetingPanelState } from './controller.ts'
import css from './MeetingPanel.module.css'

/** Registration-private controller face. */
export interface MeetingPanelInjected {
  hooks: {
    /** Complete panel state bound by the slot renderer as `useMeeting`. */
    meeting: SnapshotStore<MeetingPanelState>
  }
  open: () => void
  close: () => void
  setDraft: (value: string) => void
  join: () => Promise<void>
  leave: () => Promise<void>
}

/** Full sidebar action props. */
export type MeetingPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'meeting'>
  & InjectFace<MeetingPanelInjected>

function statusCopy(status: MeetingPanelState['presence']['status']):
  'idle' | 'starting' | 'waitingAdmission' | 'joined' | 'leaving' | 'left' | 'failed' {
  return status === 'waiting-admission' ? 'waitingAdmission' : status
}

function providerName(provider: MeetingPanelState['presence']['provider']): string {
  if (provider === 'google-meet') return 'Google Meet'
  if (provider === 'zoom') return 'Zoom'
  return '—'
}

/** Render the meeting trigger and its full-viewport panel. */
export function MeetingPanel({ wide, useMeeting, open, close, setDraft, join, leave, t }: MeetingPanelProps) {
  const state = useMeeting(value => value)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement>(null)
  const active = ['starting', 'waiting-admission', 'joined', 'leaving'].includes(state.presence.status)
  const joining = state.pending === 'join' || state.presence.status === 'starting'
  const leaving = state.pending === 'leave' || state.presence.status === 'leaving'

  useEffect(() => {
    if (!state.open) return
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKeyDown)
    closeButton.current?.focus()
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [state.open, close])

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-label={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={state.open}
        onClick={open}
      >
        <IconUserOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
        {active && <span className={css.activeDot} aria-hidden="true" />}
      </button>
      {state.open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={close} />
          <section className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className={css.header}>
              <div>
                <h2 className={css.title} id={titleId}>{t('title')}</h2>
                <p className={css.description}>{t('description')}</p>
              </div>
              <button ref={closeButton} type="button" className={css.close} onClick={close} aria-label={t('close')}>
                <IconCloseOutline16 size={16} />
              </button>
            </header>

            <form className={css.form} onSubmit={(event) => { event.preventDefault(); void join() }}>
              <label className={css.label} htmlFor={`${titleId}-url`}>{t('urlLabel')}</label>
              <input
                id={`${titleId}-url`}
                className={css.input}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={state.draft}
                placeholder={t('urlPlaceholder')}
                disabled={active}
                onChange={(event) => { setDraft(event.currentTarget.value) }}
              />
              <p className={css.provider}>{t('provider')}</p>

              <div className={clsx(css.status, css[`status-${state.presence.status}`])} aria-live="polite">
                <div className={css.statusHeading}>
                  {(joining || leaving) && <IconLoadingOutline16 className={css.spinner} size={16} />}
                  <span>{t(statusCopy(state.presence.status))}</span>
                </div>
                {state.presence.status === 'waiting-admission' && <p>{t('waitingHint')}</p>}
                {state.presence.status === 'joined' && <p>{t('joinedHint')}</p>}
                {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}
                {state.presence.meetingUrl !== null && (
                  <dl className={css.details}>
                    <div><dt>{t('platform')}</dt><dd>{providerName(state.presence.provider)}</dd></div>
                    <div><dt>{t('name')}</dt><dd>{state.presence.botName}</dd></div>
                  </dl>
                )}
              </div>

              <div className={css.actions}>
                {active
                  ? (
                    <button type="button" className={css.secondary} disabled={leaving} onClick={() => { void leave() }}>
                      {leaving ? t('leaving') : t('leave')}
                    </button>
                  )
                  : (
                    <button type="submit" className={css.primary} disabled={state.draft.trim() === '' || joining}>
                      {joining ? t('joining') : state.presence.status === 'failed' ? t('retry') : t('join')}
                    </button>
                  )}
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}
