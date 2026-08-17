/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'preview.title': '文件预览',
  'preview.tabs': '文件预览标签页',
  'preview.addTab': '新建标签页',
  'preview.newTab': '新标签页',
  'preview.blank': '从会话中点击 HTML 或 DOCX 文件，在此标签页中打开。',
  'preview.close': '关闭预览',
  'preview.closeTab': '关闭 {name}',
  'preview.loading': '正在加载预览…',
  'preview.failed': '无法加载预览。',
  'preview.frameTitle': '{name} 预览',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
  'preview.title': 'File preview',
  'preview.tabs': 'File preview tabs',
  'preview.addTab': 'New tab',
  'preview.newTab': 'New tab',
  'preview.blank': 'Click an HTML or DOCX file in the conversation to open it in this tab.',
  'preview.close': 'Close preview',
  'preview.closeTab': 'Close {name}',
  'preview.loading': 'Loading preview…',
  'preview.failed': 'Unable to load preview.',
  'preview.frameTitle': '{name} preview',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
