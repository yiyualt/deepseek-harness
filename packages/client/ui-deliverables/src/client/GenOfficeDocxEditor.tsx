/** Continuous rich-text editor for locally stored GenOffice DOCX artifacts. */

import type { GenOfficeDocxBlock, GenOfficeDocxRun } from '@deepseek-ai/dsh-client-connection/client'
import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import {
  GenOfficeRibbon, GenOfficeRibbonButton, GenOfficeRibbonGroup, GenOfficeRibbonTabs,
  GenOfficeRibbonUnavailable, type GenOfficeRibbonButtonState,
} from './GenOfficeRibbon.tsx'
import css from './ArtifactPreviewPanel.module.css'

const FONTS = ['宋体', '微软雅黑', 'Arial', 'Calibri', 'Times New Roman'] as const
const FONT_SIZES = [9, 10.5, 12, 14, 16, 18, 22, 26, 32] as const
const RIBBON_TABS = [
  'home', 'insert', 'draw', 'design', 'layout', 'references', 'mailings', 'review', 'view',
] as const
type RibbonTab = typeof RIBBON_TABS[number]

function requiredClassName(value: string | undefined): string {
  if (value === undefined) throw new Error('GenOffice editor CSS class is unavailable')
  return value
}

const DocxBlockAttributes = Extension.create({
  name: 'docxBlockAttributes',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      docxIndex: { default: null, rendered: false },
      blockType: {
        default: 'paragraph',
        parseHTML: element => element.getAttribute('data-block-type') ?? 'paragraph',
        renderHTML: attributes => ({ 'data-block-type': String(attributes.blockType) }),
      },
    } }]
  },
})

const ProtectedBlock = Node.create({
  name: 'docxProtected',
  group: 'block',
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      docxIndex: { default: null, rendered: false },
      label: { default: '', rendered: false },
      text: { default: '', rendered: false },
    }
  },
  renderHTML({ node }) {
    return ['div', { class: css.genOfficeProtected, contenteditable: 'false' },
      ['span', { class: css.genOfficeProtectedLabel }, String(node.attrs.label)],
      ...(node.attrs.text === '' ? [] : [['span', {}, String(node.attrs.text)]]),
    ]
  },
})

function topLevelIndexes(content: { forEach: (callback: (node: { attrs: Record<string, unknown> }) => void) => void }): unknown[] {
  const indexes: unknown[] = []
  content.forEach(node => indexes.push(node.attrs.docxIndex))
  return indexes
}

const PreserveDocxBlocks = Extension.create({
  name: 'preserveDocxBlocks',
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction(transaction, state) {
      if (!transaction.docChanged) return true
      return JSON.stringify(topLevelIndexes(state.doc)) === JSON.stringify(topLevelIndexes(transaction.doc))
    } })]
  },
})

const EnterAsLineBreak = Extension.create({
  name: 'enterAsLineBreak',
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() }
  },
})

function runMarks(run: GenOfficeDocxRun): NonNullable<JSONContent['marks']> {
  const marks: NonNullable<JSONContent['marks']> = []
  if (run.bold) marks.push({ type: 'bold' })
  if (run.italic) marks.push({ type: 'italic' })
  if (run.underline) marks.push({ type: 'underline' })
  if (run.strike) marks.push({ type: 'strike' })
  const textStyle: Record<string, string> = {}
  if (run.color !== undefined) textStyle.color = `#${run.color}`
  if (run.font !== undefined) textStyle.fontFamily = run.font
  if (run.sizeHalfPoints !== undefined) textStyle.fontSize = `${String(run.sizeHalfPoints / 2)}pt`
  if (Object.keys(textStyle).length > 0) marks.push({ type: 'textStyle', attrs: textStyle })
  if (run.shading !== undefined) marks.push({ type: 'highlight', attrs: { color: `#${run.shading}` } })
  return marks
}

function runContent(run: GenOfficeDocxRun): JSONContent[] {
  const marks = runMarks(run)
  return run.text.split('\n').flatMap((text, index, parts): JSONContent[] => [
    ...(text === '' ? [] : [{ type: 'text', text, marks }]),
    ...(index === parts.length - 1 ? [] : [{ type: 'hardBreak', marks }]),
  ])
}

function editorContent(blocks: readonly GenOfficeDocxBlock[], protectedLabel: string): JSONContent {
  return { type: 'doc', content: blocks.map((block): JSONContent => {
    if (!block.editable) return { type: 'docxProtected', attrs: {
      docxIndex: block.docxIndex, label: block.label ?? protectedLabel, text: block.text,
    } }
    const attrs: Record<string, unknown> = {
      docxIndex: block.docxIndex,
      blockType: block.type,
      textAlign: block.align === 'both' ? 'justify' : (block.align ?? 'left'),
    }
    if (block.type === 'heading') attrs.level = Math.min(6, Math.max(1, block.level ?? 1))
    const runs = block.runs ?? [{ text: block.text }]
    return {
      type: block.type === 'heading' ? 'heading' : 'paragraph', attrs,
      content: runs.flatMap(runContent),
    }
  }) }
}

function hexAttribute(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1).toUpperCase() : undefined
}

function runFromNode(node: JSONContent): GenOfficeDocxRun | undefined {
  if (node.type !== 'text' && node.type !== 'hardBreak') return undefined
  if (node.type === 'text' && node.text === undefined) return undefined
  const run: GenOfficeDocxRun = { text: node.type === 'hardBreak' ? '\n' : node.text ?? '' }
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') run.bold = true
    if (mark.type === 'italic') run.italic = true
    if (mark.type === 'underline') run.underline = true
    if (mark.type === 'strike') run.strike = true
    if (mark.type === 'highlight') {
      const shading = hexAttribute(mark.attrs?.color)
      if (shading !== undefined) run.shading = shading
    }
    if (mark.type === 'textStyle') {
      const color = hexAttribute(mark.attrs?.color)
      if (color !== undefined) run.color = color
      if (typeof mark.attrs?.fontFamily === 'string') run.font = mark.attrs.fontFamily
      if (typeof mark.attrs?.fontSize === 'string') {
        const points = Number.parseFloat(mark.attrs.fontSize)
        if (Number.isFinite(points)) run.sizeHalfPoints = Math.round(points * 2)
      }
    }
  }
  return run
}

function sameRunStyle(left: GenOfficeDocxRun, right: GenOfficeDocxRun): boolean {
  return JSON.stringify({ ...left, text: '' }) === JSON.stringify({ ...right, text: '' })
}

function blocksFromEditor(editor: Editor, source: readonly GenOfficeDocxBlock[]): GenOfficeDocxBlock[] {
  const originals = new Map(source.map(block => [block.docxIndex, block]))
  return editor.getJSON().content.flatMap((node): GenOfficeDocxBlock[] => {
    const attributes = node.attrs as unknown as Record<string, unknown>
    const docxIndex = attributes.docxIndex
    if (typeof docxIndex !== 'number') return []
    const original = originals.get(docxIndex)
    if (original === undefined || !original.editable) return original === undefined ? [] : [structuredClone(original)]
    const runs: GenOfficeDocxRun[] = []
    for (const child of node.content ?? []) {
      const run = runFromNode(child)
      if (run === undefined) continue
      const previous = runs.at(-1)
      if (previous !== undefined && sameRunStyle(previous, run)) previous.text += run.text
      else runs.push(run)
    }
    if (runs.length === 0) runs.push({ text: '' })
    const textAlign = attributes.textAlign
    const align = textAlign === 'justify' ? 'both'
      : textAlign === 'center' || textAlign === 'right' ? textAlign : 'left'
    return [{ ...original, text: runs.map(run => run.text).join(''), runs, align }]
  })
}

function editorStringAttribute(editor: Editor, extension: string, attribute: string): string {
  const attributes = editor.getAttributes(extension) as unknown as Record<string, unknown>
  const value = attributes[attribute]
  return typeof value === 'string' ? value : ''
}

function selectedMarkAttribute(editor: Editor, markName: string, attribute: string): { value: string; mixed: boolean } {
  const { from, to, empty } = editor.state.selection
  if (empty) return { value: editorStringAttribute(editor, markName, attribute), mixed: false }
  const values = new Set<string>()
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    const mark = node.marks.find(candidate => candidate.type.name === markName)
    const attributes: unknown = mark?.attrs
    const value = typeof attributes === 'object' && attributes !== null
      ? (attributes as Record<string, unknown>)[attribute]
      : undefined
    values.add(typeof value === 'string' ? value : '')
  })
  return values.size === 1 ? { value: [...values][0] ?? '', mixed: false } : { value: '', mixed: true }
}

function selectedMarkState(editor: Editor, markName: string): GenOfficeRibbonButtonState {
  const { from, to, empty } = editor.state.selection
  if (empty) return editor.isActive(markName) ? 'on' : 'off'
  const states = new Set<boolean>()
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    states.add(node.marks.some(mark => mark.type.name === markName))
  })
  return states.size > 1 ? 'mixed' : states.has(true) ? 'on' : 'off'
}

function selectedCharacterCount(editor: Editor): number {
  const { from, to, empty } = editor.state.selection
  return empty ? 0 : editor.state.doc.textBetween(from, to, '').length
}

/** Render one continuous document surface and write its supported rich text back to DOCX. */
export function GenOfficeDocxEditor({ tab, edit, save, t }: {
  tab: ArtifactPreviewTab
  edit: (blocks: GenOfficeDocxBlock[]) => void
  save: () => void
  t: ArtifactPreviewPanelProps['t']
}) {
  const blocks = tab.genOfficeBlocks ?? []
  const dirty = JSON.stringify(blocks) !== JSON.stringify(tab.genOfficeSavedBlocks ?? [])
  const error = tab.genOfficeConflict ? t('preview.genOfficeConflict') : tab.genOfficeError
  const locked = tab.genOfficeSaving === true || tab.genOfficeConflict === true
  const revision = tab.genOfficeRevision
  const syncedRevision = useRef(revision)
  const selection = useRef({ from: 1, to: 1 })
  const [activeTab, setActiveTab] = useState<RibbonTab>('home')
  const [, renderToolbar] = useReducer((value: number): number => value + 1, 0)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ blockquote: false, bulletList: false, codeBlock: false, horizontalRule: false,
        orderedList: false, listItem: false }),
      Underline, TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      DocxBlockAttributes, ProtectedBlock, PreserveDocxBlocks, EnterAsLineBreak,
    ],
    content: editorContent(blocks, t('preview.genOfficeProtected')),
    editorProps: { attributes: {
      class: requiredClassName(css.genOfficeDocument), 'aria-label': t('preview.genOfficeDocument'),
    } },
    onUpdate: ({ editor: updated }) => {
      edit(blocksFromEditor(updated, blocks))
      renderToolbar()
    },
    onSelectionUpdate: ({ editor: updated }) => {
      selection.current = { from: updated.state.selection.from, to: updated.state.selection.to }
      renderToolbar()
    },
  }, [tab.id])

  useEffect(() => {
    if (revision === syncedRevision.current) return
    syncedRevision.current = revision
    editor.commands.setContent(editorContent(blocks, t('preview.genOfficeProtected')), { emitUpdate: false })
  }, [blocks, editor, revision, t])

  useEffect(() => {
    editor.setEditable(!locked)
  }, [editor, locked])

  const chain = () => editor.chain().setTextSelection(selection.current).focus()
  const font = selectedMarkAttribute(editor, 'textStyle', 'fontFamily')
  const fontSize = selectedMarkAttribute(editor, 'textStyle', 'fontSize')
  const selectedCharacters = selectedCharacterCount(editor)
  return <div className={css.genOfficeEditor}>
    <div className={css.genOfficeTitlebar}>
      <span className={css.genOfficeEngine}>{t('preview.genOfficeEngine')}</span>
      <span className={css.genOfficeState}>{tab.genOfficeSaving
        ? t('preview.genOfficeSaving') : dirty ? t('preview.genOfficeUnsaved') : t('preview.genOfficeSaved')}</span>
      <button type="button" className={css.genOfficeSave}
        disabled={!dirty || tab.genOfficeSaving || tab.genOfficeConflict} onClick={save}>
        {t('preview.genOfficeSave')}
      </button>
    </div>
    <GenOfficeRibbonTabs tabs={RIBBON_TABS.map(id => ({ id, label: t(`preview.genOfficeTab.${id}`) }))}
      active={activeTab} label={t('preview.genOfficeRibbonTabs')} onChange={setActiveTab} />
    {activeTab === 'home' ? <GenOfficeRibbon label={t('preview.genOfficeToolbar')}>
      <GenOfficeRibbonGroup label={t('preview.genOfficeHistory')}>
        <GenOfficeRibbonButton large label={t('preview.genOfficeUndo')} disabled={locked || !editor.can().undo()}
          action={() => { chain().undo().run() }}><span>↶</span><small>{t('preview.genOfficeUndo')}</small></GenOfficeRibbonButton>
        <GenOfficeRibbonButton large label={t('preview.genOfficeRedo')} disabled={locked || !editor.can().redo()}
          action={() => { chain().redo().run() }}><span>↷</span><small>{t('preview.genOfficeRedo')}</small></GenOfficeRibbonButton>
      </GenOfficeRibbonGroup>
      <GenOfficeRibbonGroup label={t('preview.genOfficeFontGroup')}>
        <div className={css.genOfficeFontRow}>
          <select className={css.genOfficeFontSelect} aria-label={t('preview.genOfficeFont')}
            disabled={locked} value={font.value}
            onChange={event => chain().setFontFamily(event.target.value).run()}>
            <option value="">{font.mixed ? t('preview.genOfficeMixed') : t('preview.genOfficeFont')}</option>
            {font.value !== '' && !FONTS.includes(font.value as typeof FONTS[number])
              && <option value={font.value}>{font.value}</option>}
            {FONTS.map(fontName => <option key={fontName} value={fontName}>{fontName}</option>)}
          </select>
          <select className={css.genOfficeSizeSelect} aria-label={t('preview.genOfficeFontSize')}
            disabled={locked} value={fontSize.value}
            onChange={event => chain().setFontSize(event.target.value).run()}>
            <option value="">{fontSize.mixed ? t('preview.genOfficeMixed') : '12'}</option>
            {fontSize.value !== '' && !FONT_SIZES.some(size => `${String(size)}pt` === fontSize.value)
              && <option value={fontSize.value}>{fontSize.value.replace(/pt$/, '')}</option>}
            {FONT_SIZES.map(size => <option key={size} value={`${String(size)}pt`}>{size}</option>)}
          </select>
        </div>
        <div className={css.genOfficeFontRow}>
          <GenOfficeRibbonButton label={t('preview.genOfficeBold')} state={selectedMarkState(editor, 'bold')} disabled={locked}
            action={() => { chain().toggleBold().run() }}><strong>B</strong></GenOfficeRibbonButton>
          <GenOfficeRibbonButton label={t('preview.genOfficeItalic')} state={selectedMarkState(editor, 'italic')} disabled={locked}
            action={() => { chain().toggleItalic().run() }}><em>I</em></GenOfficeRibbonButton>
          <GenOfficeRibbonButton label={t('preview.genOfficeUnderline')} state={selectedMarkState(editor, 'underline')} disabled={locked}
            action={() => { chain().toggleUnderline().run() }}><u>U</u></GenOfficeRibbonButton>
          <GenOfficeRibbonButton label={t('preview.genOfficeStrike')} state={selectedMarkState(editor, 'strike')} disabled={locked}
            action={() => { chain().toggleStrike().run() }}><s>S</s></GenOfficeRibbonButton>
          <label className={css.genOfficeColorTool} title={t('preview.genOfficeTextColor')}>
            A<input type="color" aria-label={t('preview.genOfficeTextColor')} disabled={locked} defaultValue="#202124"
              onChange={event => chain().setColor(event.target.value).run()} />
          </label>
          <label className={css.genOfficeColorTool} title={t('preview.genOfficeHighlight')}>
            ▰<input type="color" aria-label={t('preview.genOfficeHighlight')} disabled={locked} defaultValue="#fff59d"
              onChange={event => chain().setHighlight({ color: event.target.value }).run()} />
          </label>
        </div>
      </GenOfficeRibbonGroup>
      <GenOfficeRibbonGroup label={t('preview.genOfficeParagraph')}>
        <GenOfficeRibbonButton label={t('preview.genOfficeAlignLeft')}
          state={editor.isActive({ textAlign: 'left' }) ? 'on' : 'off'} disabled={locked}
          action={() => { chain().setTextAlign('left').run() }}>☰</GenOfficeRibbonButton>
        <GenOfficeRibbonButton label={t('preview.genOfficeAlignCenter')}
          state={editor.isActive({ textAlign: 'center' }) ? 'on' : 'off'} disabled={locked}
          action={() => { chain().setTextAlign('center').run() }}>≡</GenOfficeRibbonButton>
        <GenOfficeRibbonButton label={t('preview.genOfficeAlignRight')}
          state={editor.isActive({ textAlign: 'right' }) ? 'on' : 'off'} disabled={locked}
          action={() => { chain().setTextAlign('right').run() }}>☷</GenOfficeRibbonButton>
        <GenOfficeRibbonButton label={t('preview.genOfficeJustify')}
          state={editor.isActive({ textAlign: 'justify' }) ? 'on' : 'off'} disabled={locked}
          action={() => { chain().setTextAlign('justify').run() }}>▤</GenOfficeRibbonButton>
      </GenOfficeRibbonGroup>
      <GenOfficeRibbonGroup label={t('preview.genOfficeEditing')}>
        <GenOfficeRibbonButton large label={t('preview.genOfficeSelectAll')} disabled={locked}
          action={() => { editor.commands.selectAll() }}><span>⌖</span><small>{t('preview.genOfficeSelectAll')}</small></GenOfficeRibbonButton>
      </GenOfficeRibbonGroup>
    </GenOfficeRibbon> : <GenOfficeRibbonUnavailable
      message={t('preview.genOfficeTabUnavailable', { tab: t(`preview.genOfficeTab.${activeTab}`) })} />}
    {error !== undefined && <div className={css.genOfficeError} role="alert">{error}</div>}
    <div className={css.genOfficeCanvas}>
      <div className={css.genOfficePage}>
        <BubbleMenu editor={editor} shouldShow={({ editor: current }) => (
          !locked && !current.state.selection.empty && current.isEditable
        )} options={{ placement: 'top' }}>
          <div className={css.genOfficeSelectionToolbar} role="toolbar"
            aria-label={t('preview.genOfficeSelectionToolbar')}>
            <GenOfficeRibbonButton label={t('preview.genOfficeBold')} state={selectedMarkState(editor, 'bold')}
              action={() => { chain().toggleBold().run() }}><strong>B</strong></GenOfficeRibbonButton>
            <GenOfficeRibbonButton label={t('preview.genOfficeItalic')} state={selectedMarkState(editor, 'italic')}
              action={() => { chain().toggleItalic().run() }}><em>I</em></GenOfficeRibbonButton>
            <GenOfficeRibbonButton label={t('preview.genOfficeUnderline')} state={selectedMarkState(editor, 'underline')}
              action={() => { chain().toggleUnderline().run() }}><u>U</u></GenOfficeRibbonButton>
          </div>
        </BubbleMenu>
        <EditorContent editor={editor} />
      </div>
    </div>
    <div className={css.genOfficeStatusbar} aria-live="polite">
      <span>{selectedCharacters === 0
        ? t('preview.genOfficeNoSelection')
        : t('preview.genOfficeSelectionCount', { count: selectedCharacters })}</span>
      <span>{t('preview.genOfficeLocalDocument')}</span>
    </div>
  </div>
}
