/** Browser-safe wire vocabulary for the Excel task-pane execution channel. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Correlation id minted by the Harness for one Excel invocation. */
export type ExcelCallId = Branded<'excel-call-id'>

/** Brand an already validated wire id. @param value - Raw id. @returns Branded id. */
export function ExcelCallId(value: string): ExcelCallId {
  return value as ExcelCallId
}

/** First task-pane frame binding one workbook to one Harness session. */
export interface ExcelBindFrame {
  readonly type: 'bind'
  readonly sessionId: string
  readonly workbookId: string
  readonly workbookName?: string
}

/** Host acknowledgement after a binding becomes active. */
export interface ExcelBoundFrame {
  readonly type: 'bound'
  readonly sessionId: string
  readonly workbookId: string
}

/** Harness request executed by Office.js in the task pane. */
export interface ExcelInvokeFrame {
  readonly type: 'invoke'
  readonly callId: ExcelCallId
  readonly toolName: string
  readonly arguments: JsonValue
}

/** Successful Office.js result returned to the Harness. */
export interface ExcelSuccessFrame {
  readonly type: 'result'
  readonly callId: ExcelCallId
  readonly ok: true
  readonly value: JsonValue
}

/** Failed Office.js result returned to the Harness. */
export interface ExcelFailureFrame {
  readonly type: 'result'
  readonly callId: ExcelCallId
  readonly ok: false
  readonly error: string
}

/** Protocol failure sent before the connection closes or an invalid frame is ignored. */
export interface ExcelErrorFrame {
  readonly type: 'error'
  readonly code: string
  readonly message: string
}

export type ExcelClientFrame = ExcelBindFrame | ExcelSuccessFrame | ExcelFailureFrame
export type ExcelServerFrame = ExcelBoundFrame | ExcelInvokeFrame | ExcelErrorFrame
