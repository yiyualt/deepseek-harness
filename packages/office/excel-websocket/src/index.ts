/** WebSocket provider for Excel task-pane execution. @module @deepseek-ai/dsh-office-excel-websocket */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue, SessionId as SessionIdType } from '@deepseek-ai/dsh-session/types'
import { OfficeExcelError } from '@deepseek-ai/dsh-office-excel'
import type { ExcelInvokeRequest, ExcelProvider } from '@deepseek-ai/dsh-office-excel'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { ExcelCallId } from './protocol.ts'
import type {
  ExcelBindFrame, ExcelClientFrame, ExcelFailureFrame, ExcelInvokeFrame,
  ExcelServerFrame, ExcelSuccessFrame,
} from './protocol.ts'

export type * from './protocol.ts'

export const name = 'office-excel-websocket'
export const inject = ['agents', 'officeExcel', 'webServer']
export const EXCEL_WEBSOCKET_PATH = '/api/office-excel'

/** WebSocket transport limits and origin allowlist. */
export interface Config {
  /** Exact browser origins allowed to upgrade into the workbook channel. */
  readonly allowedOrigins: string[]
  /** Maximum encoded size accepted for one client frame. */
  readonly maxMessageBytes: number
  /** Time allowed for a new task pane to bind a live Harness Session. */
  readonly bindTimeoutMs: number
  /** Maximum wall-clock time for one Office.js invocation. */
  readonly invokeTimeoutMs: number
}

export const Config: z<Config> = z.object({
  allowedOrigins: z.array(String).default(['https://localhost:3010']),
  maxMessageBytes: z.natural().min(1024).default(1024 * 1024),
  bindTimeoutMs: z.natural().min(1).default(10_000),
  invokeTimeoutMs: z.natural().min(1).default(60_000),
})

interface PendingCall {
  readonly resolve: (value: JsonValue) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly removeAbort: () => void
}

interface BoundConnection {
  readonly socket: WebSocket
  readonly sessionId: SessionIdType
  readonly workbookId: string
  readonly pending: Map<string, PendingCall>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseClientFrame(data: RawData, isBinary: boolean): ExcelClientFrame {
  if (isBinary) throw new Error('binary frames are unsupported')
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.from(data as ArrayBuffer).toString('utf8')
  const parsed: unknown = JSON.parse(text)
  const value = record(parsed)
  if (value === undefined || typeof value.type !== 'string') throw new Error('frame must be a tagged object')
  if (value.type === 'bind') {
    if (typeof value.sessionId !== 'string' || value.sessionId.length === 0
      || typeof value.workbookId !== 'string' || value.workbookId.length === 0
      || (value.workbookName !== undefined && typeof value.workbookName !== 'string')) {
      throw new Error('bind requires non-empty sessionId and workbookId')
    }
    return {
      type: 'bind', sessionId: value.sessionId, workbookId: value.workbookId,
      ...(value.workbookName === undefined ? {} : { workbookName: value.workbookName }),
    }
  }
  if (value.type === 'result') {
    if (typeof value.callId !== 'string' || value.callId.length === 0 || typeof value.ok !== 'boolean') {
      throw new Error('result requires callId and ok')
    }
    if (value.ok) {
      const detached = snapshotJsonValue(value.value)
      if (detached === undefined) throw new Error('result value must be lossless JSON')
      return { type: 'result', callId: ExcelCallId(value.callId), ok: true, value: detached as JsonValue }
    }
    if (typeof value.error !== 'string' || value.error.length === 0) throw new Error('failed result requires error')
    return { type: 'result', callId: ExcelCallId(value.callId), ok: false, error: value.error }
  }
  throw new Error(`unsupported frame type ${JSON.stringify(value.type)}`)
}

function send(socket: WebSocket, frame: ExcelServerFrame): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new OfficeExcelError('Excel task pane disconnected before invocation', 'EXCEL_WORKBOOK_DISCONNECTED'))
      return
    }
    socket.send(JSON.stringify(frame), (error) => { if (error) reject(error); else resolve() })
  })
}

class ExcelWebSocketProvider implements ExcelProvider {
  private readonly connections = new Map<SessionIdType, BoundConnection>()
  private readonly socketBindings = new Map<WebSocket, BoundConnection>()

  constructor(private readonly ctx: Context, private readonly config: Config) {}

  connected(sessionId: SessionIdType): boolean {
    return this.connections.get(sessionId)?.socket.readyState === WebSocket.OPEN
  }

  async invoke(request: ExcelInvokeRequest): Promise<JsonValue> {
    const connection = this.connections.get(request.sessionId)
    if (connection === undefined || connection.socket.readyState !== WebSocket.OPEN) {
      throw new OfficeExcelError('Excel workbook disconnected before invocation', 'EXCEL_WORKBOOK_DISCONNECTED')
    }
    const callId = ExcelCallId(randomUUID())
    return new Promise<JsonValue>((resolve, reject) => {
      const settle = (outcome: { value: JsonValue } | { error: Error }): void => {
        const pending = connection.pending.get(callId)
        if (pending === undefined) return
        connection.pending.delete(callId)
        clearTimeout(pending.timer)
        pending.removeAbort()
        if ('value' in outcome) resolve(outcome.value)
        else reject(outcome.error)
      }
      const onAbort = (): void => { settle({ error: new OfficeExcelError('Excel invocation was aborted', 'EXCEL_INVOKE_ABORTED') }) }
      const timer = setTimeout(() => { settle({
        error: new OfficeExcelError(`Excel invocation timed out after ${String(this.config.invokeTimeoutMs)}ms`, 'EXCEL_INVOKE_TIMEOUT'),
      }) }, this.config.invokeTimeoutMs)
      request.signal.addEventListener('abort', onAbort, { once: true })
      connection.pending.set(callId, {
        resolve: (value) => { settle({ value }) },
        reject: (error) => { settle({ error }) },
        timer,
        removeAbort: () => { request.signal.removeEventListener('abort', onAbort) },
      })
      const frame: ExcelInvokeFrame = {
        type: 'invoke', callId, toolName: request.toolName, arguments: request.arguments,
      }
      void send(connection.socket, frame).catch((error: unknown) => { settle({
        error: new OfficeExcelError('Unable to deliver Excel invocation', 'EXCEL_DELIVERY_FAILED', { cause: error }),
      }) })
    })
  }

  accept(socket: WebSocket): void {
    const bindTimer = setTimeout(() => {
      void send(socket, { type: 'error', code: 'BIND_TIMEOUT', message: 'Excel task pane did not bind a session' })
        .finally(() => { socket.close(1008, 'bind timeout') })
    }, this.config.bindTimeoutMs)

    socket.on('message', (data, isBinary) => {
      try {
        const frame = parseClientFrame(data, isBinary)
        if (frame.type === 'bind') this.bind(socket, frame, bindTimer)
        else this.settle(socket, frame)
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        void send(socket, { type: 'error', code: 'INVALID_FRAME', message: error instanceof Error ? error.message : String(error) })
      }
    })
    socket.once('close', () => {
      clearTimeout(bindTimer)
      this.disconnect(socket)
    })
  }

  close(): void {
    for (const connection of this.connections.values()) connection.socket.close(1001, 'Harness stopping')
    for (const socket of this.socketBindings.keys()) this.disconnect(socket)
  }

  private bind(socket: WebSocket, frame: ExcelBindFrame, bindTimer: ReturnType<typeof setTimeout>): void {
    if (this.socketBindings.has(socket)) throw new Error('socket is already bound')
    const sessionId = SessionId(frame.sessionId)
    if (this.ctx.agents.get(sessionId) === undefined) throw new Error(`unknown live Harness session ${JSON.stringify(frame.sessionId)}`)
    clearTimeout(bindTimer)
    const previous = this.connections.get(sessionId)
    if (previous !== undefined) {
      previous.socket.close(1008, 'replaced by a newer task pane')
      this.disconnect(previous.socket)
    }
    const connection: BoundConnection = { socket, sessionId, workbookId: frame.workbookId, pending: new Map() }
    this.connections.set(sessionId, connection)
    this.socketBindings.set(socket, connection)
    void send(socket, { type: 'bound', sessionId, workbookId: frame.workbookId })
  }

  private settle(socket: WebSocket, frame: ExcelSuccessFrame | ExcelFailureFrame): void {
    const connection = this.socketBindings.get(socket)
    if (connection === undefined) throw new Error('result arrived before bind')
    const pending = connection.pending.get(frame.callId)
    if (pending === undefined) return
    if (frame.ok) pending.resolve(frame.value)
    else pending.reject(new OfficeExcelError(frame.error, 'EXCEL_OFFICE_JS_FAILED'))
  }

  private disconnect(socket: WebSocket): void {
    const connection = this.socketBindings.get(socket)
    if (connection === undefined) return
    this.socketBindings.delete(socket)
    if (this.connections.get(connection.sessionId) === connection) this.connections.delete(connection.sessionId)
    for (const pending of [...connection.pending.values()]) {
      pending.reject(new OfficeExcelError('Excel task pane disconnected during invocation', 'EXCEL_WORKBOOK_DISCONNECTED'))
    }
  }
}

/** Narrow test hooks for exercising the transport without a full Web bundle. */
export const internals = { ExcelWebSocketProvider, parseClientFrame, originAllowed }

function originAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean {
  const origin = req.headers.origin
  return typeof origin === 'string' && allowed.has(origin)
}

function rejectUpgrade(socket: Duplex): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  socket.destroy()
}

/** Mount the loopback WebSocket provider. @param ctx - Host Context. @param config - Validated transport config. */
export function apply(ctx: Context, config: Config): void {
  const allowed = new Set(config.allowedOrigins)
  const server = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes })
  const provider = new ExcelWebSocketProvider(ctx, config)

  ctx.effect(() => ctx.officeExcel.registerProvider(provider), 'office-excel-websocket: provider')
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: EXCEL_WEBSOCKET_PATH,
    handler(req, socket, head) {
      if (!originAllowed(req, allowed)) {
        rejectUpgrade(socket)
        return
      }
      server.handleUpgrade(req, socket, head, (websocket) => {
        server.emit('connection', websocket, req)
        provider.accept(websocket)
      })
    },
  }), 'office-excel-websocket: upgrade route')
  ctx.effect(() => async () => {
    provider.close()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }, 'office-excel-websocket: server')
}
