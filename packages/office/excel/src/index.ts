/** Excel workbook execution capability seam. @module @deepseek-ai/dsh-office-excel */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    officeExcel: OfficeExcelService
  }
}

/** One operation addressed to the workbook bound to a Harness session. */
export interface ExcelInvokeRequest {
  /** Harness session whose Excel Add-in owns the workbook. */
  readonly sessionId: SessionId
  /** Registered Excel tool name. */
  readonly toolName: string
  /** Lossless JSON arguments validated by the model-facing tool. */
  readonly arguments: JsonValue
  /** Cancellation for the owning Harness tool call. */
  readonly signal: AbortSignal
}

/** Provider implemented by a transport connected to an Excel Add-in. */
export interface ExcelProvider {
  /** Whether the session currently has a bound workbook connection. */
  connected(sessionId: SessionId): boolean
  /** Execute one operation in the bound workbook. */
  invoke(request: ExcelInvokeRequest): Promise<JsonValue>
}

/** Stable failures exposed by the Excel capability. */
export class OfficeExcelError extends HarnessError {
  /** @param message - Human-readable failure. @param code - Stable failure code. @param options - Optional cause. */
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'OfficeExcelError'
  }
}

/** Single-provider Excel capability service. */
export class OfficeExcelService extends Service {
  private provider: ExcelProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'officeExcel')
  }

  /**
   * Register the active Excel transport provider.
   * @param provider - Transport implementation.
   * @returns Registration disposer.
   */
  registerProvider(provider: ExcelProvider): () => void {
    const dispose = this.ctx.effect(function* (this: OfficeExcelService) {
      if (this.provider !== undefined) {
        throw new OfficeExcelError('an Excel provider is already registered', 'EXCEL_DUPLICATE_PROVIDER')
      }
      this.provider = provider
      yield () => { this.provider = undefined }
    }.bind(this), 'officeExcel.registerProvider()')
    return () => void dispose()
  }

  /**
   * Check whether a session currently owns an Excel connection.
   * @param sessionId - Harness session id.
   * @returns Connection state.
   */
  connected(sessionId: SessionId): boolean {
    return this.provider?.connected(sessionId) ?? false
  }

  /**
   * Execute one request through the active provider.
   * @param request - Session, tool and arguments.
   * @returns Excel result.
   */
  invoke(request: ExcelInvokeRequest): Promise<JsonValue> {
    request.signal.throwIfAborted()
    if (this.provider === undefined) {
      throw new OfficeExcelError('Excel integration is unavailable in this Harness composition', 'EXCEL_PROVIDER_UNAVAILABLE')
    }
    if (!this.provider.connected(request.sessionId)) {
      throw new OfficeExcelError('No Excel workbook is connected to this session. Open the DSH Excel task pane and retry.', 'EXCEL_WORKBOOK_DISCONNECTED')
    }
    return this.provider.invoke(request)
  }
}

export default OfficeExcelService
