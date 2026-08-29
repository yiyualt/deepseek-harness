type Args = Record<string, unknown>
type CellValue = string | number | boolean | null

const MAX_READ_CELLS = 5_000
const MAX_CHART_SOURCE_CELLS = 5_000

const CHART_TYPES = {
  columnClustered: Excel.ChartType.columnClustered,
  barClustered: Excel.ChartType.barClustered,
  line: Excel.ChartType.line,
  pie: Excel.ChartType.pie,
  area: Excel.ChartType.area,
  doughnut: Excel.ChartType.doughnut,
  xyScatter: Excel.ChartType.xyscatter,
} as const

const SERIES_BY = {
  auto: Excel.ChartSeriesBy.auto,
  columns: Excel.ChartSeriesBy.columns,
  rows: Excel.ChartSeriesBy.rows,
} as const

function argsRecord(value: unknown): Args {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('tool arguments must be an object')
  return value as Args
}

function requiredString(args: Args, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-empty string`)
  return value
}

function worksheet(context: Excel.RequestContext, args: Args): Excel.Worksheet {
  const name = args.sheet
  if (name === undefined) return context.workbook.worksheets.getActiveWorksheet()
  if (typeof name !== 'string' || name.length === 0) throw new Error('sheet must be a non-empty string')
  return context.workbook.worksheets.getItem(name)
}

function cell(value: unknown): value is CellValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function matrix(value: unknown): CellValue[][] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('values must contain at least one row')
  const rows = value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0 || !row.every(cell)) throw new Error(`values[${String(rowIndex)}] must be a non-empty scalar row`)
    return row
  })
  const columns = rows[0]?.length ?? 0
  if (!rows.every(row => row.length === columns)) throw new Error('values must be rectangular')
  return rows
}

async function inspect(args: Args): Promise<Record<string, unknown>> {
  return Excel.run(async (context) => {
    const worksheets = context.workbook.worksheets
    const active = worksheets.getActiveWorksheet()
    const selected = context.workbook.getSelectedRange()
    worksheets.load('items/name')
    active.load('name')
    selected.load('address,rowCount,columnCount')
    await context.sync()
    const result: Record<string, unknown> = {
      worksheets: worksheets.items.map(item => item.name),
      activeSheet: active.name,
      selection: { address: selected.address, rows: selected.rowCount, columns: selected.columnCount },
    }
    if (args.includeSelection !== false && selected.rowCount * selected.columnCount <= MAX_READ_CELLS) {
      selected.load('values,formulas,text')
      await context.sync()
      result.selection = {
        address: selected.address, rows: selected.rowCount, columns: selected.columnCount,
        values: selected.values, formulas: selected.formulas, text: selected.text,
      }
    }
    return result
  })
}

async function readRange(args: Args): Promise<Record<string, unknown>> {
  const address = requiredString(args, 'address')
  return Excel.run(async (context) => {
    const sheet = worksheet(context, args)
    const range = sheet.getRange(address)
    sheet.load('name')
    range.load('address,rowCount,columnCount')
    await context.sync()
    if (range.rowCount * range.columnCount > MAX_READ_CELLS) throw new Error(`range exceeds the ${String(MAX_READ_CELLS)} cell read limit`)
    range.load('values,formulas,text')
    await context.sync()
    return {
      sheet: sheet.name, address: range.address, rows: range.rowCount, columns: range.columnCount,
      values: range.values, formulas: range.formulas, text: range.text,
    }
  })
}

async function writeRange(args: Args): Promise<Record<string, unknown>> {
  const address = requiredString(args, 'address')
  const values = matrix(args.values)
  return Excel.run(async (context) => {
    const sheet = worksheet(context, args)
    const range = sheet.getRange(address)
    sheet.load('name')
    range.load('address,rowCount,columnCount')
    await context.sync()
    if (range.rowCount !== values.length || range.columnCount !== values[0]?.length) {
      throw new Error(`target is ${String(range.rowCount)}x${String(range.columnCount)} but values are ${String(values.length)}x${String(values[0]?.length ?? 0)}`)
    }
    range.values = values
    await context.sync()
    range.load('values,text')
    await context.sync()
    return { sheet: sheet.name, address: range.address, values: range.values, text: range.text }
  })
}

async function clearRange(args: Args): Promise<Record<string, unknown>> {
  const address = requiredString(args, 'address')
  const applyTo = args.applyTo === 'all' ? Excel.ClearApplyTo.all : Excel.ClearApplyTo.contents
  return Excel.run(async (context) => {
    const sheet = worksheet(context, args)
    const range = sheet.getRange(address)
    sheet.load('name')
    range.load('address,rowCount,columnCount')
    await context.sync()
    range.clear(applyTo)
    await context.sync()
    range.load('values,text')
    await context.sync()
    return { sheet: sheet.name, address: range.address, values: range.values, text: range.text }
  })
}

async function createWorksheet(args: Args): Promise<Record<string, unknown>> {
  const name = requiredString(args, 'name').trim()
  if (name.length > 31) throw new Error('worksheet name must contain at most 31 characters')
  if (/[\\/:?*[\]]/.test(name)) throw new Error('worksheet name contains an invalid character')
  const activate = args.activate === undefined ? true : args.activate
  if (typeof activate !== 'boolean') throw new Error('activate must be a boolean')

  return Excel.run(async (context) => {
    const worksheets = context.workbook.worksheets
    const existing = worksheets.getItemOrNullObject(name)
    existing.load('isNullObject')
    await context.sync()
    if (!existing.isNullObject) throw new Error(`worksheet ${JSON.stringify(name)} already exists`)

    const sheet = worksheets.add(name)
    if (activate) sheet.activate()
    sheet.load('name,position')
    await context.sync()
    return { name: sheet.name, position: sheet.position, activated: activate }
  })
}

async function insertChart(args: Args): Promise<Record<string, unknown>> {
  const sourceAddress = requiredString(args, 'sourceAddress')
  const startCell = requiredString(args, 'startCell')
  const endCell = requiredString(args, 'endCell')
  const chartTypeName = requiredString(args, 'chartType')
  if (!(chartTypeName in CHART_TYPES)) throw new Error(`unsupported chartType ${JSON.stringify(chartTypeName)}`)
  const seriesByName = args.seriesBy === undefined ? 'auto' : requiredString(args, 'seriesBy')
  if (!(seriesByName in SERIES_BY)) throw new Error(`unsupported seriesBy ${JSON.stringify(seriesByName)}`)
  const title = args.title === undefined ? undefined : requiredString(args, 'title')
  const name = args.name === undefined ? undefined : requiredString(args, 'name')

  return Excel.run(async (context) => {
    const sheet = worksheet(context, args)
    const source = sheet.getRange(sourceAddress)
    sheet.load('name')
    source.load('address,rowCount,columnCount')
    await context.sync()
    if (source.rowCount * source.columnCount > MAX_CHART_SOURCE_CELLS) {
      throw new Error(`chart source exceeds the ${String(MAX_CHART_SOURCE_CELLS)} cell limit`)
    }

    const chartType = CHART_TYPES[chartTypeName as keyof typeof CHART_TYPES]
    const seriesBy = SERIES_BY[seriesByName as keyof typeof SERIES_BY]
    const chart = sheet.charts.add(chartType, source, seriesBy)
    chart.setPosition(startCell, endCell)
    if (title !== undefined) {
      chart.title.text = title
      chart.title.visible = true
    }
    if (name !== undefined) chart.name = name
    chart.load('name,chartType,left,top,width,height')
    chart.title.load('text,visible')
    await context.sync()

    return {
      sheet: sheet.name,
      sourceAddress: source.address,
      name: chart.name,
      chartType: chart.chartType,
      title: chart.title.visible ? chart.title.text : null,
      position: { startCell, endCell, left: chart.left, top: chart.top, width: chart.width, height: chart.height },
    }
  })
}

/** Execute an enabled DSH Excel tool inside the Office.js context. */
export async function executeExcelTool(toolName: string, value: unknown): Promise<unknown> {
  const args = argsRecord(value)
  switch (toolName) {
    case 'excel_inspect': return inspect(args)
    case 'excel_read_range': return readRange(args)
    case 'excel_write_range': return writeRange(args)
    case 'excel_clear_range': return clearRange(args)
    case 'excel_create_worksheet': return createWorksheet(args)
    case 'excel_insert_chart': return insertChart(args)
    default: throw new Error(`unknown Excel tool ${JSON.stringify(toolName)}`)
  }
}
