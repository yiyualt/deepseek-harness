/** Local GenOffice PPTX slide and text-box editor. */

import type {
  GenOfficePptxElement, GenOfficePptxSlide, GenOfficePptxTextStyle,
} from '@deepseek-ai/dsh-client-connection/client'
import { useState, type CSSProperties } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import css from './ArtifactPreviewPanel.module.css'

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

function SlideCanvas({ slide, selected, locked, select, edit, textBoxLabel }: {
  slide: GenOfficePptxSlide
  selected: number | undefined
  locked: boolean
  select: (elementIndex: number) => void
  edit: (elementIndex: number, text: string, style: GenOfficePptxTextStyle) => void
  textBoxLabel: (elementIndex: number) => string
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
            style={{ ...position, opacity: element.opacity }}
            src={element.dataUrl}
            alt=""
          />
        )
        if (element.kind === 'shape') return (
          <div
            key={element.elementIndex}
            className={css.genOfficePptxShape}
            style={{ ...position, background: element.fill ?? 'transparent', borderColor: element.stroke ?? 'transparent' }}
          />
        )
        if (element.kind === 'protected') return (
          <div key={element.elementIndex} className={css.genOfficePptxProtected} style={position} title={element.label} />
        )
        return (
          <textarea
            key={element.elementIndex}
            className={css.genOfficePptxText}
            data-selected={selected === element.elementIndex || undefined}
            data-editable={element.editable || undefined}
            style={{ ...position, ...visualStyle(element, slide) }}
            value={element.text}
            readOnly={!element.editable || locked}
            aria-label={textBoxLabel(element.elementIndex)}
            onFocus={() => { if (element.editable && !locked) select(element.elementIndex) }}
            onClick={() => { if (element.editable && !locked) select(element.elementIndex) }}
            onChange={(event) => { edit(element.elementIndex, event.target.value, element.style) }}
          />
        )
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
  const slide = slides[activeIndex] ?? slides[0]
  const selected = slide?.elements.find(element => (
    element.elementIndex === selectedIndex && element.kind === 'text' && element.editable
  ))
  const dirty = isDirty(tab)
  const locked = tab.genOfficePptxSaving === true || tab.genOfficePptxConflict === true
  const error = tab.genOfficePptxConflict ? t('preview.genOfficeConflict') : tab.genOfficePptxError
  const changeStyle = (patch: Partial<GenOfficePptxTextStyle>) => {
    if (slide === undefined || selected?.kind !== 'text' || locked) return
    edit(slide.slideIndex, selected.elementIndex, selected.text, { ...selected.style, ...patch })
  }

  return (
    <div className={css.genOfficePptxEditor}>
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
      <div className={css.genOfficeRibbonTabs}><span>{t('preview.genOfficeHome')}</span></div>
      <div className={css.genOfficePptxToolbar} role="toolbar" aria-label={t('preview.genOfficeToolbar')}>
        <select
          className={css.genOfficePptxSelect}
          aria-label={t('preview.genOfficeFont')}
          disabled={selected?.kind !== 'text' || locked}
          value={selected?.kind === 'text' ? selected.style.fontFamily ?? 'Arial' : 'Arial'}
          onChange={(event) => { changeStyle({ fontFamily: event.target.value }) }}
        >
          <option value="Arial">Arial</option>
          <option value="Calibri">Calibri</option>
          <option value="Microsoft YaHei">微软雅黑</option>
          <option value="SimSun">宋体</option>
        </select>
        <input
          className={css.genOfficePptxSize}
          type="number"
          min="6"
          max="144"
          aria-label={t('preview.genOfficeFontSize')}
          disabled={selected?.kind !== 'text' || locked}
          value={selected?.kind === 'text' ? selected.style.fontSize ?? 18 : 18}
          onChange={(event) => {
            const fontSize = Number(event.target.value)
            if (Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 144) changeStyle({ fontSize })
          }}
        />
        {([
          ['bold', 'preview.genOfficeBold'],
          ['italic', 'preview.genOfficeItalic'],
          ['underline', 'preview.genOfficeUnderline'],
        ] as const).map(([property, label]) => (
          <button
            key={property}
            type="button"
            className={css.genOfficePptxFormat}
            aria-label={t(label)}
            aria-pressed={selected?.kind === 'text' ? selected.style[property] : false}
            disabled={selected?.kind !== 'text' || locked}
            onClick={() => { if (selected?.kind === 'text') changeStyle({ [property]: !selected.style[property] }) }}
          >
            {property === 'bold' ? 'B' : property === 'italic' ? 'I' : 'U'}
          </button>
        ))}
        <input
          className={css.genOfficePptxColor}
          type="color"
          aria-label={t('preview.genOfficeTextColor')}
          disabled={selected?.kind !== 'text' || locked}
          value={selected?.kind === 'text' && /^#[\da-f]{6}$/i.test(selected.style.color ?? '')
            ? selected.style.color : '#000000'}
          onChange={(event) => { changeStyle({ color: event.target.value }) }}
        />
        {([
          ['left', 'preview.genOfficeAlignLeft'],
          ['center', 'preview.genOfficeAlignCenter'],
          ['right', 'preview.genOfficeAlignRight'],
        ] as const).map(([align, label]) => (
          <button
            key={align}
            type="button"
            className={css.genOfficePptxFormat}
            aria-label={t(label)}
            aria-pressed={selected?.kind === 'text' && selected.style.align === align}
            disabled={selected?.kind !== 'text' || locked}
            onClick={() => { changeStyle({ align }) }}
          >
            {align === 'left' ? '⇤' : align === 'center' ? '↔' : '⇥'}
          </button>
        ))}
      </div>
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
              onClick={() => { setActiveIndex(index); setSelectedIndex(undefined) }}
            >
              <span>{index + 1}</span>
              <span className={css.genOfficePptxThumbnailPage} style={{ aspectRatio: `${String(candidate.width)} / ${String(candidate.height)}` }} />
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
                textBoxLabel={elementIndex => t('preview.genOfficePptxTextBox', {
                  slide: slide.slideIndex + 1,
                  element: elementIndex + 1,
                })}
              />
            )}
        </div>
      </div>
    </div>
  )
}
