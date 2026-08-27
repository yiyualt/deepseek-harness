/** Continuous rich-text editor for locally stored GenOffice DOCX artifacts. */

import type { GenOfficeDocxBlock, GenOfficeDocxRun } from '@deepseek-ai/dsh-client-connection/client'
import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useReducer, useRef } from 'react'
import type { ArtifactPreviewTab } from './artifact-preview-store.ts'
import type { ArtifactPreviewPanelProps } from './ArtifactPreviewPanel.tsx'
import css from './ArtifactPreviewPanel.module.css'

const FONTS = ['宋体', '微软雅黑', 'Arial', 'Calibri', 'Times New Roman'] as const
const FONT_SIZES = [9, 10.5, 12, 14, 16, 18, 22, 26, 32] as const

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
      content: runs.flatMap(run => run.text === '' ? [] : [{ type: 'text', text: run.text, marks: runMarks(run) }]),
    }
  }) }
}

function hexAttribute(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1).toUpperCase() : undefined
}

function runFromNode(node: JSONContent): GenOfficeDocxRun | undefined {
  if (node.type !== 'text' || node.text === undefined) return undefined
  const run: GenOfficeDocxRun = { text: node.text }
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

function ToolbarButton({ active, label, children, action }: {
  active: boolean
  label: string
  children: string
  action: () => void
}) {
  return <button type="button" className={css.genOfficeToolButton} data-active={active || undefined}
    aria-label={label} title={label} onMouseDown={(event) => { event.preventDefault() }} onClick={action}>
    {children}
  </button>
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
  const revision = tab.genOfficeRevision
  const syncedRevision = useRef(revision)
  const [, renderToolbar] = useReducer((value: number): number => value + 1, 0)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ blockquote: false, bulletList: false, codeBlock: false, horizontalRule: false,
        orderedList: false, listItem: false }),
      Underline, TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      DocxBlockAttributes, ProtectedBlock, PreserveDocxBlocks,
    ],
    content: editorContent(blocks, t('preview.genOfficeProtected')),
    editorProps: { attributes: {
      class: requiredClassName(css.genOfficeDocument), 'aria-label': t('preview.genOfficeDocument'),
    } },
    onUpdate: ({ editor: updated }) => { edit(blocksFromEditor(updated, blocks)) },
    onSelectionUpdate: renderToolbar,
  }, [tab.id])

  useEffect(() => {
    if (revision === syncedRevision.current) return
    syncedRevision.current = revision
    editor.commands.setContent(editorContent(blocks, t('preview.genOfficeProtected')), { emitUpdate: false })
  }, [blocks, editor, revision, t])

  const chain = () => editor.chain().focus()
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
    <div className={css.genOfficeRibbonTabs}><span>{t('preview.genOfficeHome')}</span></div>
    <div className={css.genOfficeRibbon} role="toolbar" aria-label={t('preview.genOfficeToolbar')}>
      <div className={css.genOfficeToolGroup}>
        <select className={css.genOfficeFontSelect} aria-label={t('preview.genOfficeFont')}
          value={editorStringAttribute(editor, 'textStyle', 'fontFamily')}
          onChange={event => chain().setFontFamily(event.target.value).run()}>
          <option value="">{t('preview.genOfficeFont')}</option>
          {FONTS.map(font => <option key={font} value={font}>{font}</option>)}
        </select>
        <select className={css.genOfficeSizeSelect} aria-label={t('preview.genOfficeFontSize')}
          value={editorStringAttribute(editor, 'textStyle', 'fontSize')}
          onChange={event => chain().setFontSize(event.target.value).run()}>
          <option value="">12</option>
          {FONT_SIZES.map(size => <option key={size} value={`${String(size)}pt`}>{size}</option>)}
        </select>
        <ToolbarButton label={t('preview.genOfficeBold')} active={editor.isActive('bold')}
          action={() => { chain().toggleBold().run() }}>B</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeItalic')} active={editor.isActive('italic')}
          action={() => { chain().toggleItalic().run() }}>I</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeUnderline')} active={editor.isActive('underline')}
          action={() => { chain().toggleUnderline().run() }}>U</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeStrike')} active={editor.isActive('strike')}
          action={() => { chain().toggleStrike().run() }}>S</ToolbarButton>
        <label className={css.genOfficeColorTool} title={t('preview.genOfficeTextColor')}>
          A<input type="color" aria-label={t('preview.genOfficeTextColor')} defaultValue="#202124"
            onChange={event => chain().setColor(event.target.value).run()} />
        </label>
        <label className={css.genOfficeColorTool} title={t('preview.genOfficeHighlight')}>
          ▰<input type="color" aria-label={t('preview.genOfficeHighlight')} defaultValue="#fff59d"
            onChange={event => chain().setHighlight({ color: event.target.value }).run()} />
        </label>
      </div>
      <div className={css.genOfficeToolGroup}>
        <ToolbarButton label={t('preview.genOfficeAlignLeft')} active={editor.isActive({ textAlign: 'left' })}
          action={() => { chain().setTextAlign('left').run() }}>☰</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeAlignCenter')} active={editor.isActive({ textAlign: 'center' })}
          action={() => { chain().setTextAlign('center').run() }}>≡</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeAlignRight')} active={editor.isActive({ textAlign: 'right' })}
          action={() => { chain().setTextAlign('right').run() }}>☷</ToolbarButton>
        <ToolbarButton label={t('preview.genOfficeJustify')} active={editor.isActive({ textAlign: 'justify' })}
          action={() => { chain().setTextAlign('justify').run() }}>▤</ToolbarButton>
      </div>
    </div>
    {error !== undefined && <div className={css.genOfficeError} role="alert">{error}</div>}
    <div className={css.genOfficeCanvas}>
      <div className={css.genOfficePage}><EditorContent editor={editor} /></div>
    </div>
  </div>
}
