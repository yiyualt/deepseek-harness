import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import OfficeExcel, { OfficeExcelError, type ExcelInvokeRequest, type ExcelProvider } from '../src/index.ts'

const sessionId = SessionId('excel-test-session')

function provider(): { value: ExcelProvider; connected: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> } {
  const connected = vi.fn(() => true)
  const invoke = vi.fn(async (request: ExcelInvokeRequest) => ({ toolName: request.toolName, arguments: request.arguments }))
  return { value: { connected, invoke }, connected, invoke }
}

describe('OfficeExcelService', () => {
  it('routes one invocation to the registered provider by Session id', async () => {
    const ctx = new Context()
    await ctx.plugin(OfficeExcel)
    const active = provider()
    ctx.officeExcel.registerProvider(active.value)

    const result = await ctx.officeExcel.invoke({
      sessionId,
      toolName: 'excel_read_range',
      arguments: { address: 'A1:B2' },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ toolName: 'excel_read_range', arguments: { address: 'A1:B2' } })
    expect(active.connected).toHaveBeenCalledWith(sessionId)
    expect(active.invoke).toHaveBeenCalledWith(expect.objectContaining({ sessionId }))
    await ctx.fiber.dispose()
  })

  it('fails explicitly when no provider or workbook is available', async () => {
    const ctx = new Context()
    await ctx.plugin(OfficeExcel)
    const request = {
      sessionId,
      toolName: 'excel_inspect',
      arguments: {},
      signal: new AbortController().signal,
    } as const

    expect(() => ctx.officeExcel.invoke(request)).toThrow(expect.objectContaining({ code: 'EXCEL_PROVIDER_UNAVAILABLE' }))
    ctx.officeExcel.registerProvider({ ...provider().value, connected: () => false })
    expect(() => ctx.officeExcel.invoke(request)).toThrow(expect.objectContaining({ code: 'EXCEL_WORKBOOK_DISCONNECTED' }))
    await ctx.fiber.dispose()
  })

  it('rejects duplicate providers and unregisters idempotently', async () => {
    const ctx = new Context()
    await ctx.plugin(OfficeExcel)
    const dispose = ctx.officeExcel.registerProvider(provider().value)

    expect(() => ctx.officeExcel.registerProvider(provider().value)).toThrow(OfficeExcelError)
    dispose()
    dispose()
    expect(() => ctx.officeExcel.registerProvider(provider().value)).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('does not reach a provider when the owning tool call is already aborted', async () => {
    const ctx = new Context()
    await ctx.plugin(OfficeExcel)
    const active = provider()
    ctx.officeExcel.registerProvider(active.value)
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))

    expect(() => ctx.officeExcel.invoke({ sessionId, toolName: 'excel_inspect', arguments: {}, signal: abort.signal }))
      .toThrow('cancelled')
    expect(active.invoke).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
