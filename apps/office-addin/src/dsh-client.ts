interface RpcSuccess<T> { readonly ok: true; readonly value: T }
interface RpcFailure { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
interface ServerResponse<T> { readonly type: 'server-response'; readonly rpcId: string; readonly result: RpcSuccess<T> | RpcFailure }
interface RpcReceipt { readonly accepted: boolean; readonly reason?: string }

export interface MuxEnvelope {
  readonly rpcId: string
  readonly payload: Record<string, unknown>
}

/** Send one unary request through the existing DSH browser API. */
export async function rpc<T>(method: string, payload: unknown): Promise<T> {
  const rpcId = crypto.randomUUID()
  const response = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`DSH API ${method} returned HTTP ${String(response.status)}`)
  const envelope = await response.json() as ServerResponse<T>
  if (envelope.rpcId !== rpcId) throw new Error(`DSH API ${method} returned a mismatched rpcId`)
  if (!envelope.result.ok) throw new Error(`${envelope.result.error.code}: ${envelope.result.error.message}`)
  return envelope.result.value
}

export function parseMuxMessage(data: unknown): MuxEnvelope | undefined {
  if (typeof data !== 'string') return undefined
  try {
    const envelope = JSON.parse(data) as { type?: unknown; rpcId?: unknown; payload?: unknown }
    if (envelope.type !== 'server-request') return undefined
    if (typeof envelope.rpcId !== 'string'
      || typeof envelope.payload !== 'object' || envelope.payload === null || Array.isArray(envelope.payload)) return undefined
    return { rpcId: envelope.rpcId, payload: envelope.payload as Record<string, unknown> }
  } catch (error) {
    console.error('[dsh-office] invalid mux frame', error)
    return undefined
  }
}

/** Open the existing all-session WebSocket event stream with bounded reconnect backoff. */
export function openMux(onFrame: (envelope: MuxEnvelope) => void, onState: (connected: boolean) => void): () => void {
  let stopped = false
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 500

  const connect = (): void => {
    if (stopped) return
    const url = new URL('/api/events.mux', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      retryDelay = 500
      onState(true)
    })
    socket.addEventListener('message', (event) => {
      const envelope = parseMuxMessage(event.data)
      if (envelope !== undefined) onFrame(envelope)
      else console.error('[dsh-office] dropping malformed mux frame')
    })
    socket.addEventListener('error', () => { socket?.close() })
    socket.addEventListener('close', () => {
      if (stopped) return
      onState(false)
      retryTimer = setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 5_000)
    })
  }

  connect()
  return () => {
    stopped = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    socket?.close()
  }
}

/** Answer one host-initiated question or approval using its mux rpcId. */
export async function respond(rpcId: string, result: RpcSuccess<unknown> | RpcFailure): Promise<void> {
  const response = await fetch('/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId, result }),
  })
  if (!response.ok) throw new Error(`DSH interaction response returned HTTP ${String(response.status)}`)
  const receipt = await response.json() as RpcReceipt
  if (!receipt.accepted) throw new Error(`DSH interaction response rejected: ${receipt.reason ?? 'unknown reason'}`)
}

/** Read all text blocks from a model message. */
export function messageText(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const content = (value as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content.map((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return ''
    const item = block as Record<string, unknown>
    return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  }).join('')
}
