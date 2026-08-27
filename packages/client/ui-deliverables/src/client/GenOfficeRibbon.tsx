/** Shared Office-style ribbon primitives for GenOffice artifact editors. */

import type { ReactNode } from 'react'
import css from './ArtifactPreviewPanel.module.css'

/** One format-specific tab displayed in the shared GenOffice ribbon. */
export interface GenOfficeRibbonTab<T extends string> {
  id: T
  label: string
}

/** Selection-aware state shown by a GenOffice ribbon button. */
export type GenOfficeRibbonButtonState = 'off' | 'on' | 'mixed'

/** Render a format-specific tab row with consistent Office-style interaction. */
export function GenOfficeRibbonTabs<T extends string>({ tabs, active, label, onChange }: {
  tabs: readonly GenOfficeRibbonTab<T>[]
  active: T
  label: string
  onChange: (tab: T) => void
}) {
  return <div className={css.genOfficeRibbonTabs} role="tablist" aria-label={label}>
    {tabs.map(tab => <button key={tab.id} type="button" role="tab"
      aria-selected={active === tab.id} onClick={() => { onChange(tab.id) }}>
      {tab.label}
    </button>)}
  </div>
}

/** Render the command surface for the active GenOffice ribbon tab. */
export function GenOfficeRibbon({ label, children }: { label: string; children: ReactNode }) {
  return <div className={css.genOfficeRibbon} role="toolbar" aria-label={label}>{children}</div>
}

/** Group related GenOffice commands under one visible label. */
export function GenOfficeRibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className={css.genOfficeToolGroup}>
    <div className={css.genOfficeToolGroupControls}>{children}</div>
    <span className={css.genOfficeToolGroupLabel}>{label}</span>
  </div>
}

/** Render a selection-preserving GenOffice ribbon command button. */
export function GenOfficeRibbonButton({ state, label, children, action, disabled = false, large = false }: {
  state?: GenOfficeRibbonButtonState
  label: string
  children: ReactNode
  action: () => void
  disabled?: boolean
  large?: boolean
}) {
  return <button type="button" className={large ? css.genOfficeLargeToolButton : css.genOfficeToolButton}
    data-active={state === 'on' || undefined} data-mixed={state === 'mixed' || undefined}
    aria-pressed={state === undefined ? undefined : state === 'mixed' ? 'mixed' : state === 'on'}
    aria-label={label} title={label}
    disabled={disabled} onMouseDown={(event) => { event.preventDefault() }} onClick={action}>
    {children}
  </button>
}

/** Explain why the selected ribbon tab has no local mutation support. */
export function GenOfficeRibbonUnavailable({ message }: { message: string }) {
  return <div className={css.genOfficeRibbonUnavailable} role="status">{message}</div>
}
