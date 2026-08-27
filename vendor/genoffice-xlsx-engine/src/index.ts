export {
  applyCellEditsToXlsx,
  readBasicWorkbook,
  type CellEdit,
  type ImportedXlsx,
} from './gateway/xlsx-gateway.ts'
export type {
  CellScalar,
  CellState,
  WorkbookSnapshot,
  WorksheetState,
} from './domain/workbook.types.ts'
export type { WorkbookStyleEdit } from './shared/desktop-api.ts'
