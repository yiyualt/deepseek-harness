export * from './types.ts'
export { parseFontTable } from './font-table.ts'
export { parseDocx, styleRunFormat, type ParseExtras } from './parse.ts'
export {
  saveDocx,
  findChartWorkbookPath,
  readDocxPartBase64,
  type SaveBlock,
  type SaveOptions,
  type StyleUpsert,
  type ParsedDocFull,
} from './patch.ts'
export {
  TABLE_HEADER_FILL,
  applyImageWrap,
  applyImageZOrder,
  buildAnchoredTextboxParagraphXml,
  buildShapeParagraphXml,
  buildTextboxParagraphXml,
  buildWordArtParagraphXml,
  type AnchoredTextboxOptions,
  type TextboxContentParagraph,
  generateCaptionXml,
  generateIndexFieldXml,
  generateParagraphXml,
  generateTableModelXml,
  generateTableXml,
  generateTocFieldXml,
  mergePPrFormat,
  setPPrChange,
  stripPPrChange,
  patchFieldParagraphXml,
  patchImageParagraphXml,
  patchMathTokens,
  patchTableCellTexts,
  patchTextboxHeights,
  patchTextboxParas,
  patchTextboxSizes,
  patchShapeStyles,
  type ShapeStylePatch,
  patchDrawingExtent,
  buildLineParagraphXml,
  LINE_KINDS,
  type TextboxSizePatch,
  type CellTextsPatch,
  type FieldTextPatch,
  type GenerateContext,
  type ImagePatch,
  type TextboxParaPatch,
  type TextboxParasPatchSet,
  type TableGenOptions,
  type TocEntry,
} from './generate.ts'
export {
  buildChartPartXml,
  buildChartWorkbookXlsxBase64,
  patchChartWorkbookXlsxBase64,
  parseChartPartXml,
  patchChartPartXml,
  lumHex,
  CHART_WORKBOOK_REL_TYPE,
  type ChartPatch,
  type ChartSeriesPatch,
} from './chart.ts'
export {
  latexToOmml,
  mathParagraphXml,
  mathTokensOf,
  ommlFragmentsOf,
  ommlToLatex,
  ommlToMathML,
} from './math.ts'
export { scanBody, type BodyElement, type BodyScan } from './scan.ts'
export {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  buildBlankDocx,
  type BlankDocxOptions,
  type CustomNumberingLevel,
} from './blank.ts'
export {
  DEFAULT_SECTION,
  applySectionSettings,
  applyPageNumType,
  applySectionStartType,
  readPageColor,
  readSections,
  readSectionSettings,
  sectionSettingsFromXml,
} from './section.ts'
export { nextNoteId, parseNotesXml, type NoteKind } from './notes.ts'
export { readWatermarkText } from './watermark.ts'
export {
  INK_NAME_PREFIX,
  anchoredInkRunXml,
  findInkRuns,
  injectInkRunsIntoParagraph,
  stripInkRuns,
} from './ink.ts'
export { bibliographyLine, citationText, parseSourcesXml } from './sources.ts'
export { readThemeColors, readThemeFonts } from './theme.ts'
export { hashProtectionPassword, verifyProtectionPassword } from './protection.ts'
export { decodeSymbolChar, decodeSymbolText, isSymbolFont, toSymbolPua } from './symbol-fonts.ts'
export {
  bulletMarkerScale,
  computeListMarkerInfos,
  computeListMarkers,
  customEnumItems,
  formatNumber,
  markerTabAdvance,
  type ListItemRef,
  type ListMarkerInfo,
} from './list-markers.ts'
