export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface ExcelBindFrame {
  type: 'bind'
  sessionId: string
  workbookId: string
  workbookName?: string
}

export interface ExcelResultFrame {
  type: 'result'
  callId: string
  ok: true
  value: JsonValue
}

export interface ExcelFailureFrame {
  type: 'result'
  callId: string
  ok: false
  error: string
}

export type ExcelClientFrame = ExcelBindFrame | ExcelResultFrame | ExcelFailureFrame

export interface ExcelInvokeFrame {
  type: 'invoke'
  callId: string
  toolName: string
  arguments: JsonValue
}

export interface ExcelBoundFrame {
  type: 'bound'
  sessionId: string
  workbookId: string
}

export interface ExcelErrorFrame {
  type: 'error'
  code: string
  message: string
}

export type ExcelServerFrame = ExcelInvokeFrame | ExcelBoundFrame | ExcelErrorFrame

/** Make the WebSocket boundary reject non-JSON values instead of silently losing data. */
export function toJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  return JSON.parse(encoded) as JsonValue
}
