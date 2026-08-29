/** Model-facing tools for the workbook connected through `ctx.officeExcel`. @module @deepseek-ai/dsh-tool-excel */

import type { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-office-excel'

export const name = 'tool-excel'
export const inject = ['officeExcel', 'tools']

const output = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

/** Register the enabled Excel tools. @param ctx - Context carrying tools and the Excel capability. */
export function apply(ctx: Context): void {
  const invoke = (
    toolName: string,
    args: unknown,
    exec: { readonly agent?: import('@deepseek-ai/dsh-agent').Agent; readonly signal: AbortSignal },
  ): Promise<JsonValue> => {
    const agent = exec.agent
    if (agent === undefined) throw new Error(`${toolName} requires a calling Harness agent`)
    const detached = snapshotJsonValue(args)
    if (detached === undefined) throw new Error(`${toolName} arguments must be lossless JSON`)
    return ctx.officeExcel.invoke({ sessionId: agent.session.id, toolName, arguments: detached as JsonValue, signal: exec.signal })
  }

  ctx.tools.register(defineTool({
    name: 'excel_inspect',
    description: 'Inspect the connected Excel workbook: worksheets, active sheet, and current selection. Call this before editing when workbook structure is unknown.',
    parameters: {
      includeSelection: { type: 'boolean', description: 'Include the selected range values and formulas. Defaults to true.' },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_inspect', args, exec)
    },
    presentCall: () => ({ card: 'generic', title: 'Inspect Excel workbook', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'excel_read_range',
    description: 'Read values, formulas, and display text from one bounded Excel range. Omit sheet to use the active worksheet.',
    parameters: {
      sheet: { type: 'string', description: 'Worksheet name. Omit for the active worksheet.' },
      address: { type: 'string', required: true, description: 'A1 address such as A1:D20. Use a bounded range, never an entire worksheet.' },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_read_range', args, exec)
    },
    presentCall: args => ({ card: 'generic', title: 'Read Excel range', kind: 'read', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'excel_write_range',
    description: 'Write a rectangular matrix of literal values to one Excel range, then read the range back. The matrix dimensions must exactly match the target range.',
    parameters: {
      sheet: { type: 'string', description: 'Worksheet name. Omit for the active worksheet.' },
      address: { type: 'string', required: true, description: 'Bounded A1 target address such as B2:D4.' },
      values: {
        type: 'array', required: true, description: 'Rectangular row-major matrix of JSON scalar values.',
        items: { type: 'array', items: { type: 'json' } },
      },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_write_range', args, exec)
    },
    presentCall: args => ({ card: 'generic', title: 'Write Excel range', kind: 'edit', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'excel_clear_range',
    description: 'Clear values or all content and formatting from one bounded Excel range, then read the range back.',
    parameters: {
      sheet: { type: 'string', description: 'Worksheet name. Omit for the active worksheet.' },
      address: { type: 'string', required: true, description: 'Bounded A1 target address.' },
      applyTo: { type: 'string', enum: ['contents', 'all'], description: 'Clear only contents (default) or all formatting and contents.' },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_clear_range', args, exec)
    },
    presentCall: args => ({ card: 'generic', title: 'Clear Excel range', kind: 'delete', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'excel_create_worksheet',
    description: 'Create a new worksheet in the connected Excel workbook. Use this for analysis, dashboard, or staging output that must not overwrite source data. The call fails if the worksheet already exists.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique worksheet name, up to 31 characters.' },
      activate: { type: 'boolean', description: 'Activate the new worksheet after creation. Defaults to true.' },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_create_worksheet', args, exec)
    },
    presentCall: args => ({ card: 'generic', title: 'Create Excel worksheet', kind: 'edit', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'excel_insert_chart',
    description: 'Insert a real chart object into the connected Excel worksheet from a bounded source range. Choose an explicit destination so the chart does not cover source data. Omit sheet to use the active worksheet.',
    parameters: {
      sheet: { type: 'string', description: 'Worksheet name. Omit for the active worksheet.' },
      sourceAddress: { type: 'string', required: true, description: 'Bounded A1 source range including category and series headers, such as A1:D8.' },
      chartType: {
        type: 'string', required: true,
        enum: ['columnClustered', 'barClustered', 'line', 'pie', 'area', 'doughnut', 'xyScatter'],
        description: 'Chart type to create.',
      },
      seriesBy: { type: 'string', enum: ['auto', 'columns', 'rows'], description: 'Interpret series automatically (default), by columns, or by rows.' },
      startCell: { type: 'string', required: true, description: 'Top-left destination cell, such as F2.' },
      endCell: { type: 'string', required: true, description: 'Bottom-right destination cell, such as M18.' },
      title: { type: 'string', description: 'Visible chart title.' },
      name: { type: 'string', description: 'Optional unique Excel object name for later identification.' },
    },
    output,
    timeoutMs: 60_000,
    async execute(args, exec) {
      return invoke('excel_insert_chart', args, exec)
    },
    presentCall: args => ({ card: 'generic', title: 'Insert Excel chart', kind: 'edit', rawInput: args }),
  }))
}
