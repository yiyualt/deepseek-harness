import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { internals, type Config } from '../src/index.ts'
import type { ExcelInvokeFrame, ExcelServerFrame } from '../src/protocol.ts'

const sessionId = SessionId('excel-websocket-test')
const config: Config = {
  allowedOrigins: ['https://localhost:3010'],
  maxMessageBytes: 1024 * 1024,
  bindTimeoutMs: 1_000,
  invokeTimeoutMs: 1_000,
}

const servers: WebSocketServer[] = []
const clients: WebSocket[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate()
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
})

function nextFrame(socket: WebSocket): Promise<ExcelServerFrame> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.once('message', (data) => {
      socket.off('error', reject)
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as ArrayBuffer).toString('utf8')
      resolve(JSON.parse(text) as ExcelServerFrame)
    })
  })
}

async function connectedPair(): Promise<{
  client: WebSocket
  provider: InstanceType<typeof internals.ExcelWebSocketProvider>
}> {
  const ctx = {
    agents: { get: (id: string) => id === sessionId ? {} : undefined },
    logger: { warn: () => {} },
  } as unknown as Context
  const provider = new internals.ExcelWebSocketProvider(ctx, config)
  const server = new WebSocketServer({ port: 0 })
  servers.push(server)
  await new Promise<void>((resolve) => { server.once('listening', resolve) })
  server.on('connection', (socket) => { provider.accept(socket) })
  const port = (server.address() as AddressInfo).port
  const client = new WebSocket(`ws://127.0.0.1:${String(port)}`)
  clients.push(client)
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })
  const bound = nextFrame(client)
  client.send(JSON.stringify({ type: 'bind', sessionId, workbookId: 'book-1', workbookName: 'Budget.xlsx' }))
  await expect(bound).resolves.toMatchObject({ type: 'bound', sessionId, workbookId: 'book-1' })
  return { client, provider }
}

describe('ExcelWebSocketProvider', () => {
  it('correlates one Harness invocation with the task-pane result', async () => {
    const { client, provider } = await connectedPair()
    const incoming = nextFrame(client)
    const result = provider.invoke({
      sessionId,
      toolName: 'excel_read_range',
      arguments: { address: 'A1:B2' },
      signal: new AbortController().signal,
    })
    const invoke = await incoming as ExcelInvokeFrame
    expect(invoke).toMatchObject({ type: 'invoke', toolName: 'excel_read_range', arguments: { address: 'A1:B2' } })
    client.send(JSON.stringify({ type: 'result', callId: invoke.callId, ok: true, value: { values: [[1, 2]] } }))

    await expect(result).resolves.toEqual({ values: [[1, 2]] })
  })

  it('settles an in-flight invocation when the workbook disconnects', async () => {
    const { client, provider } = await connectedPair()
    const incoming = nextFrame(client)
    const result = provider.invoke({
      sessionId,
      toolName: 'excel_inspect',
      arguments: {},
      signal: new AbortController().signal,
    })
    await incoming
    client.close()

    await expect(result).rejects.toMatchObject({ code: 'EXCEL_WORKBOOK_DISCONNECTED' })
  })
})
