import { executeExcelTool } from './excel-tools.ts'
import { toJsonValue, type ExcelClientFrame, type ExcelInvokeFrame, type ExcelServerFrame } from './protocol.ts'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Connect the current workbook to one live DSH Session. */
export function connectExcelBridge(
  sessionId: string,
  workbookId: string,
  workbookName: string,
  onState: (connected: boolean, message: string) => void,
): () => void {
  const url = new URL('/api/office-excel', window.location.href)
  url.protocol = 'wss:'
  let stopped = false
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 500

  const connect = (): void => {
    if (stopped) return
    socket = new WebSocket(url)
    const active = socket
    active.addEventListener('open', () => {
      retryDelay = 500
      const frame: ExcelClientFrame = { type: 'bind', sessionId, workbookId, workbookName }
      active.send(JSON.stringify(frame))
    })
    active.addEventListener('error', () => { active.close() })
    active.addEventListener('close', () => {
      if (stopped) return
      onState(false, 'Excel 执行通道已断开，正在自动重连…')
      retryTimer = setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 5_000)
    })
    active.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      let frame: ExcelServerFrame
      try {
        frame = JSON.parse(event.data) as ExcelServerFrame
      } catch (error) {
        onState(false, `执行通道协议错误：${errorMessage(error)}`)
        return
      }
      if (frame.type === 'bound') {
        onState(true, 'Excel 已连接')
        return
      }
      if (frame.type === 'error') {
        onState(false, `${frame.code}: ${frame.message}`)
        return
      }
      void executeAndReply(active, frame)
    })
  }

  connect()
  return () => {
    stopped = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    socket?.close()
  }
}

async function executeAndReply(socket: WebSocket, frame: ExcelInvokeFrame): Promise<void> {
  try {
    const value = await executeExcelTool(frame.toolName, frame.arguments)
    const result: ExcelClientFrame = { type: 'result', callId: frame.callId, ok: true, value: toJsonValue(value) }
    socket.send(JSON.stringify(result))
  } catch (error) {
    const result: ExcelClientFrame = { type: 'result', callId: frame.callId, ok: false, error: errorMessage(error) }
    socket.send(JSON.stringify(result))
  }
}
