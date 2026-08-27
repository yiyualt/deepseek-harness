/** Local GenOffice PPTX slide and text-box editor. */

import type {
  GenOfficePptxElement, GenOfficePptxSlide, GenOfficePptxTextStyle,
} from '@deepseek-ai/dsh-client-connection/client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import {
  GenOfficeRibbon, GenOfficeRibbonButton, GenOfficeRibbonGroup, GenOfficeRibbonTabs,
  GenOfficeRibbonUnavailable,
} from './GenOfficeRibbon.tsx'
import css from './ArtifactPreviewPanel.module.css'

const RIBBON_TABS = [
  'home', 'insert', 'draw', 'design', 'transitions', 'animations', 'slideShow', 'record', 'review', 'view',
] as const
type RibbonTab = typeof RIBBON_TABS[number]

function elementKey(slideIndex: number, elementIndex: number): string {
  return `${String(slideIndex)}:${String(elementIndex)}`
}

function isDirty(tab: ArtifactPreviewTab): boolean {
  const saved = new Map((tab.genOfficePptxSavedSlides ?? []).flatMap(slide => slide.elements
    .filter(element => element.kind === 'text')
    .map(element => [elementKey(slide.slideIndex, element.elementIndex), element] as const)))
  return (tab.genOfficePptxSlides ?? []).some(slide => slide.elements.some((element) => {
    if (element.kind !== 'text' || !element.editable) return false
    const before = saved.get(elementKey(slide.slideIndex, element.elementIndex))
    return before?.kind !== 'text' || before.text !== element.text
      || JSON.stringify(before.style) !== JSON.stringify(element.style)
  }))
}

function elementPosition(element: GenOfficePptxElement, slide: GenOfficePptxSlide): CSSProperties {
  return {
    left: `${String(element.x / slide.width * 100)}%`,
    top: `${String(element.y / slide.height * 100)}%`,
    width: `${String(element.width / slide.width * 100)}%`,
    height: `${String(element.height / slide.height * 100)}%`,
    transform: `rotate(${String(element.rotation)}deg)`,
  }
}

function visualStyle(
  element: Extract<GenOfficePptxElement, { kind: 'text' }>,
  slide: GenOfficePptxSlide,
): CSSProperties {
  const slideWidthPoints = slide.width / 12_700
  return {
    fontFamily: element.style.fontFamily,
    fontSize: `${String((element.style.fontSize ?? 18) / slideWidthPoints * 100)}cqw`,
    fontWeight: element.style.bold ? 700 : 400,
    fontStyle: element.style.italic ? 'italic' : 'normal',
    textDecoration: element.style.underline ? 'underline' : 'none',
    color: element.style.color ?? '#000000',
    textAlign: element.style.align,
    background: element.fill ?? 'transparent',
    borderColor: element.stroke ?? 'transparent',
  }
}

function activateObject(event: React.KeyboardEvent, select: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  select()
}

function SlideThumbnail({ slide }: { slide: GenOfficePptxSlide }) {
  return <span
    className={css.genOfficePptxThumbnailPage}
    data-slide-thumbnail=""
    aria-hidden="true"
    style={{
      aspectRatio: `${String(slide.width)} / ${String(slide.height)}`,
      background: slide.background ?? '#ffffff',
    }}
  >
    {slide.elements.map((element) => {
      const position = elementPosition(element, slide)
      if (element.kind === 'picture') return element.dataUrl === undefined ? null : <img
        key={element.elementIndex}
        className={css.genOfficePptxThumbnailPicture}
        style={{ ...position, opacity: element.opacity }}
        src={element.dataUrl}
        alt=""
      />
      if (element.kind === 'shape') return <span
        key={element.elementIndex}
        className={css.genOfficePptxThumbnailShape}
        style={{ ...position, background: element.fill ?? 'transparent', borderColor: element.stroke ?? 'transparent' }}
      />
      if (element.kind === 'protected') return <span
        key={element.elementIndex}
        className={css.genOfficePptxThumbnailProtected}
        style={position}
      />
      return <span
        key={element.elementIndex}
        className={css.genOfficePptxThumbnailText}
        style={{ ...position, ...visualStyle(element, slide) }}
      >{element.text}</span>
    })}
  </span>
}

function PptxTextBox({ slide, element, selected, locked, select, edit, label }: {
  slide: GenOfficePptxSlide
  element: Extract<GenOfficePptxElement, { kind: 'text' }>
  selected: boolean
  locked: boolean
  select: () => void
  edit: (text: string, style: GenOfficePptxTextStyle) => void
  label: string
}) {
  const [draft, setDraft] = useState(element.text)
  const focused = useRef(false)
  const composing = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(element.text)
  }, [element.text])

  const commit = (text: string) => {
    if (text !== element.text) edit(text, element.style)
  }
  return <textarea
    className={css.genOfficePptxText}
    data-selected={selected || undefined}
    data-editable={element.editable || undefined}
    style={{ ...elementPosition(element, slide), ...visualStyle(element, slide) }}
    value={draft}
    readOnly={!element.editable || locked}
    aria-label={label}
    onFocus={() => {
      focused.current = true
      select()
    }}
    onClick={select}
    onCompositionStart={() => { composing.current = true }}
    onCompositionEnd={(event) => {
      composing.current = false
      commit(event.currentTarget.value)
    }}
    onChange={(event) => {
      const text = event.target.value
      setDraft(text)
      if (!composing.current) commit(text)
    }}
    onBlur={() => {
      focused.current = false
      commit(draft)
    }}
  />
}

function SlideCanvas({ slide, selected, locked, select, edit, objectLabel }: {
  slide: GenOfficePptxSlide
  selected: number | undefined
  locked: boolean
  select: (elementIndex: number) => void
  edit: (elementIndex: number, text: string, style: GenOfficePptxTextStyle) => void
  objectLabel: (element: GenOfficePptxElement) => string
}) {
  return (
    <div
      className={css.genOfficePptxSlide}
      style={{ aspectRatio: `${String(slide.width)} / ${String(slide.height)}`, background: slide.background ?? '#ffffff' }}
    >
      {slide.elements.map((element) => {
        const position = elementPosition(element, slide)
        if (element.kind === 'picture') return element.dataUrl === undefined ? null : (
          <img
            key={element.elementIndex}
            className={css.genOfficePptxPicture}
            data-selected={selected === element.elementIndex || undefined}
            style={{ ...position, opacity: element.opacity }}
            src={element.dataUrl}
            alt={objectLabel(element)}
            role="button"
            tabIndex={0}
            onClick={() => { select(element.elementIndex) }}
            onKeyDown={(event) => { activateObject(event, () => { select(element.elementIndex) }) }}
          />
        )
        if (element.kind === 'shape') return (
          <div
            key={element.elementIndex}
            className={css.genOfficePptxShape}
            data-selected={selected === element.elementIndex || undefined}
            style={{ ...position, background: element.fill ?? 'transparent', borderColor: element.stroke ?? 'transparent' }}
            role="button"
            tabIndex={0}
            aria-label={objectLabel(element)}
            onClick={() => { select(element.elementIndex) }}
            onKeyDown={(event) => { activateObject(event, () => { select(element.elementIndex) }) }}
          />
        )
        if (element.kind === 'protected') return (
          <div key={element.elementIndex} className={css.genOfficePptxProtected}
            data-selected={selected === element.elementIndex || undefined}
            style={position} title={element.label} role="button" tabIndex={0}
            aria-label={objectLabel(element)} onClick={() => { select(element.elementIndex) }}
            onKeyDown={(event) => { activateObject(event, () => { select(element.elementIndex) }) }} />
        )
        return <PptxTextBox
          key={`${String(slide.slideIndex)}:${String(element.elementIndex)}`}
          slide={slide}
          element={element}
          selected={selected === element.elementIndex}
          locked={locked}
          select={() => { select(element.elementIndex) }}
          edit={(text, style) => { edit(element.elementIndex, text, style) }}
          label={objectLabel(element)}
        />
      })}
    </div>
  )
}

/** Render the browser-safe PPTX projection and edit uniform text boxes. */
export function GenOfficePptxEditor({ tab, edit, save, t }: {
  tab: ArtifactPreviewTab
  edit: (
    slideIndex: number,
    elementIndex: number,
    text: string,
    style: GenOfficePptxTextStyle,
  ) => void
  save: () => void
  t: ArtifactPreviewPanelProps['t']
}) {
  const slides = tab.genOfficePptxSlides ?? []
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number>()
  const [activeTab, setActiveTab] = useState<RibbonTab>('home')
  const resolvedActiveIndex = Math.min(activeIndex, Math.max(0, slides.length - 1))
  const slide = slides[resolvedActiveIndex] ?? slides[0]
  const selected = slide?.elements.find(element => element.elementIndex === selectedIndex)
  const editableText = selected?.kind === 'text' && selected.editable ? selected : undefined
  const dirty = isDirty(tab)
  const locked = tab.genOfficePptxSaving === true || tab.genOfficePptxConflict === true
  const error = tab.genOfficePptxConflict ? t('preview.genOfficeConflict') : tab.genOfficePptxError
  const changeStyle = (patch: Partial<GenOfficePptxTextStyle>) => {
    if (slide === undefined || editableText === undefined || locked) return
    edit(slide.slideIndex, editableText.elementIndex, editableText.text, { ...editableText.style, ...patch })
  }
  const showSlide = (index: number) => {
    if (slides.length === 0) return
    setActiveIndex(Math.max(0, Math.min(slides.length - 1, index)))
    setSelectedIndex(undefined)
  }

  return (
    <div className={css.genOfficePptxEditor} tabIndex={0} onKeyDownCapture={(event) => {
      if (event.key === 'PageUp') {
        event.preventDefault()
        event.stopPropagation()
        showSlide(resolvedActiveIndex - 1)
      }
      if (event.key === 'PageDown') {
        event.preventDefault()
        event.stopPropagation()
        showSlide(resolvedActiveIndex + 1)
      }
    }}>
      <div className={css.genOfficeTitlebar}>
        <span className={css.genOfficeEngine}>{t('preview.genOfficePptxEngine')}</span>
        <span className={css.genOfficeState}>
          {tab.genOfficePptxSaving
            ? t('preview.genOfficeSaving')
            : dirty ? t('preview.genOfficeUnsaved') : t('preview.genOfficeSaved')}
        </span>
        <button
          type="button"
          className={css.genOfficeSave}
          disabled={!dirty || locked}
          onClick={save}
        >
          {t('preview.genOfficeSave')}
        </button>
      </div>
      <GenOfficeRibbonTabs tabs={RIBBON_TABS.map(id => ({ id, label: t(`preview.genOfficeTab.${id}`) }))}
        active={activeTab} label={t('preview.genOfficePresentationRibbonTabs')} onChange={setActiveTab} />
      {activeTab === 'home' ? <GenOfficeRibbon label={t('preview.genOfficePresentationToolbar')}>
        <GenOfficeRibbonGroup label={t('preview.genOfficeFontGroup')}>
          <div className={css.genOfficeFontRow}>
            <select className={css.genOfficePptxSelect} aria-label={t('preview.genOfficeFont')}
              disabled={editableText === undefined || locked}
              value={editableText?.style.fontFamily ?? 'Arial'}
              onChange={(event) => { changeStyle({ fontFamily: event.target.value }) }}>
              <option value="Arial">Arial</option>
              <option value="Calibri">Calibri</option>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="SimSun">宋体</option>
            </select>
            <input className={css.genOfficePptxSize} type="number" min="6" max="144"
              aria-label={t('preview.genOfficeFontSize')} disabled={editableText === undefined || locked}
              value={editableText?.style.fontSize ?? 18}
              onChange={(event) => {
                const fontSize = Number(event.target.value)
                if (Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 144) changeStyle({ fontSize })
              }} />
          </div>
          <div className={css.genOfficeFontRow}>
            {([
              ['bold', 'preview.genOfficeBold'],
              ['italic', 'preview.genOfficeItalic'],
              ['underline', 'preview.genOfficeUnderline'],
            ] as const).map(([property, label]) => (
              <GenOfficeRibbonButton key={property} label={t(label)}
                state={editableText?.style[property] ? 'on' : 'off'}
                disabled={editableText === undefined || locked}
                action={() => { if (editableText !== undefined) changeStyle({ [property]: !editableText.style[property] }) }}>
                {property === 'bold' ? <strong>B</strong> : property === 'italic' ? <em>I</em> : <u>U</u>}
              </GenOfficeRibbonButton>
            ))}
            <input className={css.genOfficePptxColor} type="color" aria-label={t('preview.genOfficeTextColor')}
              disabled={editableText === undefined || locked}
              value={editableText !== undefined && /^#[\da-f]{6}$/i.test(editableText.style.color ?? '')
                ? editableText.style.color : '#000000'}
              onChange={(event) => { changeStyle({ color: event.target.value }) }} />
          </div>
        </GenOfficeRibbonGroup>
        <GenOfficeRibbonGroup label={t('preview.genOfficeParagraph')}>
          {([
            ['left', 'preview.genOfficeAlignLeft'],
            ['center', 'preview.genOfficeAlignCenter'],
            ['right', 'preview.genOfficeAlignRight'],
          ] as const).map(([align, label]) => (
            <GenOfficeRibbonButton key={align} label={t(label)}
              state={editableText?.style.align === align ? 'on' : 'off'}
              disabled={editableText === undefined || locked} action={() => { changeStyle({ align }) }}>
              {align === 'left' ? '☰' : align === 'center' ? '≡' : '☷'}
            </GenOfficeRibbonButton>
          ))}
        </GenOfficeRibbonGroup>
      </GenOfficeRibbon> : <GenOfficeRibbonUnavailable
        message={t('preview.genOfficeTabUnavailable', { tab: t(`preview.genOfficeTab.${activeTab}`) })} />}
      {error !== undefined && <div className={css.genOfficeError} role="alert">{error}</div>}
      <div className={css.genOfficePptxWorkspace}>
        <div className={css.genOfficePptxRail} aria-label={t('preview.genOfficePptxSlides')}>
          {slides.map((candidate, index) => (
            <button
              key={candidate.slideIndex}
              type="button"
              className={css.genOfficePptxThumbnail}
              data-active={candidate.slideIndex === slide?.slideIndex || undefined}
              aria-label={t('preview.genOfficePptxSlide', { index: index + 1 })}
              onClick={() => { showSlide(index) }}
            >
              <span>{index + 1}</span>
              <SlideThumbnail slide={candidate} />
            </button>
          ))}
        </div>
        <div className={css.genOfficePptxCanvas}>
          {slide === undefined
            ? <div className={css.status}>{t('preview.genOfficePptxEmpty')}</div>
            : (
              <SlideCanvas
                slide={slide}
                selected={selectedIndex}
                locked={locked}
                select={setSelectedIndex}
                edit={(elementIndex, text, style) => { edit(slide.slideIndex, elementIndex, text, style) }}
                objectLabel={(element) => {
                  const values = { slide: slide.slideIndex + 1, element: element.elementIndex + 1 }
                  if (element.kind === 'text') return t('preview.genOfficePptxTextBox', values)
                  if (element.kind === 'picture') return t('preview.genOfficePptxPicture', values)
                  if (element.kind === 'shape') return t('preview.genOfficePptxShape', values)
                  return t('preview.genOfficePptxProtectedObject', { ...values, type: element.label })
                }}
              />
            )}
        </div>
      </div>
      <div className={css.genOfficeStatusbar} aria-live="polite">
        <span>{selected === undefined
          ? t('preview.genOfficePptxNoSelection')
          : selected.kind === 'text' && selected.editable
            ? t('preview.genOfficePptxSelection', { index: selected.elementIndex + 1 })
            : selected.kind === 'text'
              ? t('preview.genOfficePptxProtectedTextSelection', { index: selected.elementIndex + 1 })
              : selected.kind === 'picture'
                ? t('preview.genOfficePptxPictureSelection', { index: selected.elementIndex + 1 })
                : selected.kind === 'shape'
                  ? t('preview.genOfficePptxShapeSelection', { index: selected.elementIndex + 1 })
                  : t('preview.genOfficePptxProtectedSelection', {
                    index: selected.elementIndex + 1, type: selected.label,
                  })}</span>
        <div className={css.genOfficePptxNavigation}>
          <button type="button" aria-label={t('preview.genOfficePptxPreviousSlide')}
            disabled={resolvedActiveIndex <= 0} onClick={() => { showSlide(resolvedActiveIndex - 1) }}>‹</button>
          <span>{slide === undefined ? '' : t('preview.genOfficePptxSlidePosition', {
            index: resolvedActiveIndex + 1, count: slides.length,
          })}</span>
          <button type="button" aria-label={t('preview.genOfficePptxNextSlide')}
            disabled={resolvedActiveIndex >= slides.length - 1}
            onClick={() => { showSlide(resolvedActiveIndex + 1) }}>›</button>
        </div>
      </div>
    </div>
  )
}
