import { beforeAll, describe, expect, it, vi } from 'vitest'

const setPosition = vi.fn()
const addChart = vi.fn()
const chart = {
  name: 'Chart 1', chartType: 'ColumnClustered', left: 300, top: 20, width: 480, height: 320,
  title: { text: '', visible: false, load: vi.fn() },
  setPosition,
  load: vi.fn(),
}
const source = { address: 'Sheet1!A1:B4', rowCount: 4, columnCount: 2, load: vi.fn() }
const createdSheet = { name: '销售分析', position: 1, activate: vi.fn(), load: vi.fn() }
const missingSheet = { isNullObject: true, load: vi.fn() }
const sheet = {
  name: 'Sheet1', load: vi.fn(), getRange: vi.fn(() => source),
  charts: { add: addChart },
}
const context = {
  workbook: { worksheets: {
    getActiveWorksheet: vi.fn(() => sheet), getItem: vi.fn(() => sheet),
    getItemOrNullObject: vi.fn(() => missingSheet), add: vi.fn(() => createdSheet),
  } },
  sync: vi.fn(async () => {}),
}

let executeExcelTool: typeof import('../src/excel-tools.ts').executeExcelTool

beforeAll(async () => {
  vi.stubGlobal('Excel', {
    ChartType: {
      columnClustered: 'ColumnClustered', barClustered: 'BarClustered', line: 'Line', pie: 'Pie',
      area: 'Area', doughnut: 'Doughnut', xyscatter: 'XYScatter',
    },
    ChartSeriesBy: { auto: 'Auto', columns: 'Columns', rows: 'Rows' },
    run: async (callback: (value: typeof context) => Promise<unknown>) => callback(context),
  })
  ;({ executeExcelTool } = await import('../src/excel-tools.ts'))
})

describe('Excel chart tool', () => {
  it('creates, positions, titles, and returns a real chart object', async () => {
    addChart.mockReturnValue(chart)

    const result = await executeExcelTool('excel_insert_chart', {
      sourceAddress: 'A1:B4', chartType: 'columnClustered', seriesBy: 'columns',
      startCell: 'D2', endCell: 'K18', title: '季度销售额', name: 'QuarterlySales',
    })

    expect(addChart).toHaveBeenCalledWith('ColumnClustered', source, 'Columns')
    expect(setPosition).toHaveBeenCalledWith('D2', 'K18')
    expect(chart).toMatchObject({ name: 'QuarterlySales', title: { text: '季度销售额', visible: true } })
    expect(result).toEqual({
      sheet: 'Sheet1', sourceAddress: 'Sheet1!A1:B4', name: 'QuarterlySales',
      chartType: 'ColumnClustered', title: '季度销售额',
      position: { startCell: 'D2', endCell: 'K18', left: 300, top: 20, width: 480, height: 320 },
    })
  })

  it('rejects chart types outside the model-facing allowlist', async () => {
    await expect(executeExcelTool('excel_insert_chart', {
      sourceAddress: 'A1:B4', chartType: 'radar', startCell: 'D2', endCell: 'K18',
    })).rejects.toThrow('unsupported chartType "radar"')
  })
})

describe('Excel worksheet tool', () => {
  it('creates and activates a new worksheet', async () => {
    const result = await executeExcelTool('excel_create_worksheet', { name: '销售分析' })

    expect(context.workbook.worksheets.add).toHaveBeenCalledWith('销售分析')
    expect(createdSheet.activate).toHaveBeenCalled()
    expect(result).toEqual({ name: '销售分析', position: 1, activated: true })
  })

  it('rejects invalid worksheet names before calling Office.js', async () => {
    await expect(executeExcelTool('excel_create_worksheet', { name: '分析/汇总' }))
      .rejects.toThrow('worksheet name contains an invalid character')
  })
})
