/** Embedded Univer grid for locally stored GenOffice XLSX artifacts. */

import type {
  GenOfficeXlsxEdit,
  GenOfficeXlsxStyle,
} from '@deepseek-ai/dsh-client-connection/client'
import { LocaleType, mergeLocales } from '@univerjs/core'
import {
  UniverSheetsCorePreset,
} from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import { greenTheme } from '@univerjs/themes'
import { useEffect, useId, useRef, useState } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import { createGenOfficeUniver } from './create-genoffice-univer.ts'
import { GenOfficeRibbonTabs, GenOfficeRibbonUnavailable } from './GenOfficeRibbon.tsx'
import css from './ArtifactPreviewPanel.module.css'

const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values'
const RIBBON_TABS = ['home', 'insert', 'pageLayout', 'formulas', 'data', 'review', 'view'] as const
type RibbonTab = typeof RIBBON_TABS[number]

function cellCoordinates(address: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid XLSX cell address: ${address}`)
  }
  let column = 0
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

function color(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const rgb = (value as Record<string, unknown>).rgb
  if (typeof rgb !== 'string') return undefined
  const match = /^#?([0-9a-f]{6})$/i.exec(rgb)
  return match?.[1] === undefined ? undefined : `#${match[1].toUpperCase()}`
}

function decorationEnabled(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).s === 1
}

function neutralStyle(value: Record<string, unknown>): GenOfficeXlsxStyle | undefined {
  const style: GenOfficeXlsxStyle = {}
  if ('bl' in value) style.bold = value.bl === 1
  if ('it' in value) style.italic = value.it === 1
  if ('ul' in value) {
    style.underline = decorationEnabled(value.ul)
    if (style.underline) {
      style.underlineStyle = (value.ul as Record<string, unknown>).t === 10 ? 'double' : 'single'
    }
  }
  if ('st' in value) style.strikethrough = decorationEnabled(value.st)
  if (typeof value.ff === 'string' && value.ff.length > 0) style.fontFamily = value.ff
  if (typeof value.fs === 'number' && value.fs > 0) style.fontSize = value.fs
  if ('cl' in value) {
    const fontColor = value.cl === null ? null : color(value.cl)
    if (fontColor !== undefined) style.fontColor = fontColor
  }
  if ('bg' in value) {
    const fillColor = value.bg === null ? null : color(value.bg)
    if (fillColor !== undefined) style.fillColor = fillColor
  }
  const horizontal = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 6: 'distributed' } as const
  const vertical = { 1: 'top', 2: 'center', 3: 'bottom' } as const
  if (typeof value.ht === 'number' && value.ht in horizontal) {
    style.horizontalAlignment = horizontal[value.ht as keyof typeof horizontal]
  }
  if (typeof value.vt === 'number' && value.vt in vertical) {
    style.verticalAlignment = vertical[value.vt as keyof typeof vertical]
  }
  if ('tb' in value && typeof value.tb === 'number') style.wrapText = value.tb === 3
  const pattern = typeof value.n === 'object' && value.n !== null
    ? (value.n as Record<string, unknown>).pattern
    : undefined
  if (typeof pattern === 'string' && pattern.length > 0) style.numberFormat = pattern
  return Object.values(style).some(item => item !== undefined) ? style : undefined
}

function mergeEdit(
  previous: GenOfficeXlsxEdit | undefined,
  sheetName: string,
  row: number,
  column: number,
  cell: unknown,
): GenOfficeXlsxEdit | undefined {
  if (cell === null || cell === undefined) {
    return { sheetName, row, column, writeValue: true, value: null, styleReset: true }
  }
  if (typeof cell !== 'object') return previous
  const data = cell as Record<string, unknown>
  let style = previous?.style
  let styleReset = previous?.styleReset
  if (typeof data.s === 'object' && data.s !== null) {
    const delta = neutralStyle(data.s as Record<string, unknown>)
    if (delta !== undefined) style = { ...style, ...delta }
  } else if ('s' in data && data.s === null) {
    style = undefined
    styleReset = true
  }
  let writeValue = previous?.writeValue ?? false
  let value = previous?.value ?? null
  let formula = previous?.formula
  if (typeof data.f === 'string' && data.f.length > 0) {
    writeValue = true
    value = null
    formula = data.f.startsWith('=') ? data.f : `=${data.f}`
  } else if (typeof data.p === 'object' && data.p !== null) {
    const body = (data.p as Record<string, unknown>).body
    const dataStream = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).dataStream
      : undefined
    if (typeof dataStream === 'string') {
      writeValue = true
      value = dataStream.replace(/\r\n$/, '')
      formula = undefined
    }
  } else if ('v' in data) {
    const raw = data.v
    if (raw === null || raw === undefined) {
      writeValue = true
      value = null
      formula = undefined
    } else if (typeof raw === 'string' || typeof raw === 'boolean' || typeof raw === 'number') {
      writeValue = true
      value = raw
      formula = undefined
    }
  }
  if (!writeValue && style === undefined && styleReset !== true) return undefined
  return {
    sheetName, row, column, writeValue, value,
    ...(formula === undefined ? {} : { formula }),
    ...(style === undefined ? {} : { style }),
    ...(styleReset === undefined ? {} : { styleReset }),
  }
}

/** Render and journal one XLSX workbook through the free GenOffice/Univer stack. */
export function GenOfficeXlsxEditor({ tab, edit, save, t }: {
  tab: ArtifactPreviewTab
  edit: (edits: GenOfficeXlsxEdit[]) => void
  save: () => void
  t: ArtifactPreviewPanelProps['t']
}) {
  const generatedId = useId()
  const [activeTab, setActiveTab] = useState<RibbonTab>('home')
  const containerId = `genoffice-xlsx-${generatedId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const editsRef = useRef(new Map<string, GenOfficeXlsxEdit>())
  const editRef = useRef(edit)
  editRef.current = edit
  const revisionRef = useRef(tab.genOfficeXlsxRevision)
  if (revisionRef.current !== tab.genOfficeXlsxRevision) {
    revisionRef.current = tab.genOfficeXlsxRevision
    editsRef.current.clear()
  }

  useEffect(() => {
    const sheets = tab.genOfficeXlsxSheets
    if (sheets === undefined) return
    const runtime = createGenOfficeUniver({
      theme: greenTheme,
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
      presets: [UniverSheetsCorePreset({
        container: containerId,
        header: false,
        toolbar: true,
        contextMenu: true,
        formulaBar: true,
        footer: { sheetBar: true, statisticBar: true, menus: false, zoomSlider: true },
      })],
    })
    const names = new Map(sheets.map(sheet => [sheet.id, sheet.name]))
    runtime.univerAPI.createWorkbook({
      id: `xlsx-${tab.id}`,
      name: tab.name,
      sheetOrder: sheets.map(sheet => sheet.id),
      sheets: Object.fromEntries(sheets.map((sheet) => {
        const cellData: Record<number, Record<number, { v?: string | number | boolean; f?: string }>> = {}
        let maximumRow = 0
        let maximumColumn = 0
        for (const cell of sheet.cells) {
          const { row, column } = cellCoordinates(cell.address)
          maximumRow = Math.max(maximumRow, row)
          maximumColumn = Math.max(maximumColumn, column)
          const rowData = cellData[row] ?? {}
          rowData[column] = cell.formula === undefined
            ? (cell.value === null ? {} : { v: cell.value })
            : { f: cell.formula }
          cellData[row] = rowData
        }
        return [sheet.id, {
          id: sheet.id,
          name: sheet.name,
          rowCount: Math.max(1000, maximumRow + 100),
          columnCount: Math.max(26, maximumColumn + 10),
          cellData,
        }]
      })),
    })
    const changes = runtime.univerAPI.addEvent(
      runtime.univerAPI.Event.CommandExecuted,
      (event) => {
        if (event.id !== SET_RANGE_VALUES_MUTATION) return
        const options = event.options as { fromFormula?: boolean } | undefined
        if (options?.fromFormula) return
        const params = event.params as { subUnitId?: unknown; cellValue?: unknown } | undefined
        if (typeof params?.subUnitId !== 'string' || typeof params.cellValue !== 'object' || params.cellValue === null) return
        const sheetName = names.get(params.subUnitId)
        if (sheetName === undefined) return
        const cellValues = params.cellValue as Record<string, unknown>
        for (const [rowKey, rowValue] of Object.entries(cellValues)) {
          const row = Number(rowKey)
          if (!Number.isInteger(row) || row < 0 || typeof rowValue !== 'object' || rowValue === null) continue
          for (const [columnKey, cell] of Object.entries(rowValue as Record<string, unknown>)) {
            const column = Number(columnKey)
            if (!Number.isInteger(column) || column < 0) continue
            const key = `${params.subUnitId}:${rowKey}:${columnKey}`
            const merged = mergeEdit(editsRef.current.get(key), sheetName, row, column, cell)
            if (merged !== undefined) editsRef.current.set(key, merged)
          }
        }
        editRef.current([...editsRef.current.values()])
      },
    )
    return () => {
      changes.dispose()
      runtime.univer.dispose()
    }
  }, [containerId, tab.id, tab.name, tab.genOfficeXlsxSheets])

  const dirty = (tab.genOfficeXlsxEdits?.length ?? 0) > 0
  const state = tab.genOfficeXlsxSaving === true
    ? t('preview.genOfficeSaving')
    : dirty ? t('preview.genOfficeUnsaved') : t('preview.genOfficeSaved')
  return (
    <div className={css.genOfficeEditor}>
      <div className={css.genOfficeTitlebar}>
        <span className={css.genOfficeEngine}>{t('preview.genOfficeXlsxEngine')}</span>
        <span className={css.genOfficeState}>{state}</span>
        <button
          type="button"
          className={css.genOfficeSave}
          disabled={!dirty || tab.genOfficeXlsxSaving === true || tab.genOfficeXlsxConflict === true}
          onClick={save}
        >
          {t('preview.genOfficeSave')}
        </button>
      </div>
      <GenOfficeRibbonTabs tabs={RIBBON_TABS.map(id => ({ id, label: t(`preview.genOfficeTab.${id}`) }))}
        active={activeTab} label={t('preview.genOfficeSpreadsheetRibbonTabs')} onChange={setActiveTab} />
      {activeTab === 'home'
        ? <div className={css.genOfficeNativeRibbonNotice} role="status">
          {t('preview.genOfficeSpreadsheetNativeTools')}
        </div>
        : <GenOfficeRibbonUnavailable
          message={t('preview.genOfficeTabUnavailable', { tab: t(`preview.genOfficeTab.${activeTab}`) })} />}
      {tab.genOfficeXlsxError !== undefined && (
        <div className={css.genOfficeError} role="alert">
          {tab.genOfficeXlsxConflict === true ? t('preview.genOfficeConflict') : tab.genOfficeXlsxError}
        </div>
      )}
      <div id={containerId} className={css.genOfficeSpreadsheet} aria-label={t('preview.genOfficeSpreadsheet')} />
    </div>
  )
}
