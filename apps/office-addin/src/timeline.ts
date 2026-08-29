export type TimelineStatus = 'streaming' | 'running' | 'success' | 'error' | 'cancelled'

export interface TimelineItem {
  readonly id: string
  readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'notice'
  readonly title: string
  readonly text: string
  readonly status?: TimelineStatus
  readonly detail?: string
  readonly callId?: string
  readonly toolName?: string
}

export interface TimelineState {
  readonly items: TimelineItem[]
  readonly busy: boolean
  readonly activity: string
}

export const emptyTimeline: TimelineState = { items: [], busy: false, activity: 'DSH 会话已连接' }

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function contentText(value: unknown): string {
  const source = record(value)
  const content = source?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((entry) => {
    if (typeof entry === 'string') return entry
    const block = record(entry)
    if (block?.type === 'text' || block?.type === 'reasoning') return typeof block.text === 'string' ? block.text : ''
    return ''
  }).filter(Boolean).join('\n')
}

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function toolTitle(name: string): string {
  const titles: Record<string, string> = {
    excel_inspect: '检查当前工作簿',
    excel_read_range: '读取 Excel 区域',
    excel_write_range: '写入 Excel 区域',
    excel_clear_range: '清空 Excel 区域',
    excel_create_worksheet: '新建 Excel 工作表',
    excel_insert_chart: '插入 Excel 图表',
    ask_user_question: '等待你的选择',
  }
  return titles[name] ?? `调用工具：${name}`
}

function toolSummary(name: string, raw: unknown): string {
  let args: Record<string, unknown> | undefined
  if (typeof raw === 'string') {
    try { args = record(JSON.parse(raw)) } catch { return '正在准备参数…' }
  } else {
    args = record(raw)
  }
  if (args === undefined) return '正在准备参数…'
  const sheet = typeof args.sheet === 'string' ? `${args.sheet}!` : ''
  const address = typeof args.address === 'string' ? args.address : ''
  if (name === 'excel_inspect') return '读取工作表、选区和工作簿结构'
  if (name === 'excel_read_range') return `读取 ${sheet}${address || '指定区域'}`
  if (name === 'excel_write_range') return `写入 ${sheet}${address || '指定区域'}`
  if (name === 'excel_clear_range') return `清空 ${sheet}${address || '指定区域'}`
  if (name === 'excel_create_worksheet') {
    const worksheetName = typeof args.name === 'string' ? args.name : '新工作表'
    return `创建工作表「${worksheetName}」`
  }
  if (name === 'excel_insert_chart') {
    const source = typeof args.sourceAddress === 'string' ? args.sourceAddress : '指定区域'
    const start = typeof args.startCell === 'string' ? args.startCell : '指定位置'
    const end = typeof args.endCell === 'string' ? `:${args.endCell}` : ''
    return `根据 ${sheet}${source} 在 ${start}${end} 创建图表`
  }
  if (name === 'ask_user_question') return 'Agent 需要补充信息后才能继续'
  return Object.keys(args).length === 0 ? '无参数' : '参数已准备'
}

function upsert(items: readonly TimelineItem[], item: TimelineItem): TimelineItem[] {
  const index = items.findIndex(candidate => candidate.id === item.id)
  if (index === -1) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function appendDelta(items: readonly TimelineItem[], item: TimelineItem, delta: string): TimelineItem[] {
  const previous = items.find(candidate => candidate.id === item.id)
  return upsert(items, { ...item, text: `${previous?.text ?? ''}${delta}` })
}

function assistantBlockItem(
  turn: number,
  step: number,
  index: number,
  block: Record<string, unknown>,
): TimelineItem | undefined {
  const type = block.type
  const id = `assistant-${String(turn)}-${String(step)}-${String(index)}`
  if (type === 'text') {
    return { id, kind: 'assistant', title: 'DSH', text: typeof block.text === 'string' ? block.text : '', status: 'success' }
  }
  if (type === 'reasoning') {
    return { id, kind: 'reasoning', title: '思考过程', text: typeof block.text === 'string' ? block.text : '', status: 'success' }
  }
  if (type === 'tool-call') {
    const callId = typeof block.id === 'string' ? block.id : id
    const name = typeof block.name === 'string' ? block.name : 'unknown'
    const args = block.arguments ?? block.input ?? {}
    return {
      id: `tool-${callId}`, kind: 'tool', callId, toolName: name, title: toolTitle(name),
      text: toolSummary(name, args), detail: pretty(args), status: 'running',
    }
  }
  return undefined
}

function chunkEvent(state: TimelineState, data: Record<string, unknown>): TimelineState {
  const chunk = record(data.chunk)
  if (chunk === undefined) return state
  const turn = typeof data.turn === 'number' ? data.turn : 0
  const step = typeof data.step === 'number' ? data.step : 0
  const index = typeof chunk.index === 'number' ? chunk.index : 0
  const blockId = `assistant-${String(turn)}-${String(step)}-${String(index)}`
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
    return {
      ...state, busy: true, activity: 'DSH 正在回答…',
      items: appendDelta(state.items, {
        id: blockId, kind: 'assistant', title: 'DSH', text: '', status: 'streaming',
      }, chunk.text),
    }
  }
  if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
    return {
      ...state, busy: true, activity: 'DSH 正在思考…',
      items: appendDelta(state.items, {
        id: blockId, kind: 'reasoning', title: '思考过程', text: '', status: 'streaming',
      }, chunk.text),
    }
  }
  if (chunk.type === 'tool-call-delta') {
    const callId = typeof chunk.id === 'string' ? chunk.id : blockId
    const itemId = `tool-${callId}`
    const previous = state.items.find(item => item.id === itemId)
    const name = typeof chunk.name === 'string' ? chunk.name : previous?.toolName ?? 'unknown'
    const delta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
    const raw = `${previous?.detail ?? ''}${delta}`
    return {
      ...state, busy: true, activity: 'DSH 正在准备工具调用…',
      items: upsert(state.items, {
        id: itemId, kind: 'tool', callId, toolName: name, title: toolTitle(name),
        text: toolSummary(name, raw), detail: raw, status: 'running',
      }),
    }
  }
  if (chunk.type === 'block-end') {
    const block = record(chunk.block)
    if (block === undefined) return state
    const item = assistantBlockItem(turn, step, index, block)
    if (item === undefined || item.text === '') return state
    return { ...state, items: upsert(state.items, item) }
  }
  return state
}

function finalizedAssistant(state: TimelineState, data: Record<string, unknown>): TimelineState {
  const message = record(data.message)
  const content = message?.content
  if (!Array.isArray(content)) return state
  const turn = typeof data.turn === 'number' ? data.turn : 0
  const step = typeof data.step === 'number' ? data.step : 0
  let items = state.items
  for (const [index, value] of content.entries()) {
    const block = record(value)
    if (block === undefined) continue
    const item = assistantBlockItem(turn, step, index, block)
    if (item !== undefined && item.text !== '') items = upsert(items, item)
  }
  return { ...state, items, activity: 'DSH 正在继续处理…' }
}

function toolResultText(data: Record<string, unknown>): { callId: string; text: string; error: boolean; detail: string } | undefined {
  const message = record(data.message)
  const source = record(message?.source)
  const callId = typeof source?.callId === 'string' ? source.callId : undefined
  if (callId === undefined) return undefined
  const first = Array.isArray(message?.content) ? record(message.content[0]) : undefined
  const content = first?.content
  const text = contentText({ content }) || (typeof content === 'string' ? content : '')
  const error = first?.isError === true || data.error !== undefined
  return { callId, text: text || (error ? '工具执行失败' : '工具执行完成'), error, detail: pretty(content ?? data.error ?? {}) }
}

/** Fold one durable Session event into the compact Excel conversation timeline. */
export function applyTimelineEvent(state: TimelineState, eventValue: unknown): TimelineState {
  const event = record(eventValue)
  const data = record(event?.data) ?? {}
  const seq = typeof event?.seq === 'number' ? event.seq : state.items.length
  switch (event?.type) {
    case 'turn/start':
      return { ...state, busy: true, activity: 'DSH 正在处理…' }
    case 'step/start':
      return { ...state, busy: true, activity: 'DSH 正在思考…' }
    case 'assistant/chunk':
      return chunkEvent(state, data)
    case 'assistant/message':
      return finalizedAssistant(state, data)
    case 'user/message': {
      const source = record(data.source)
      if (source?.kind !== 'user') return state
      const text = contentText(data)
      return text === '' ? state : {
        ...state, items: upsert(state.items, { id: `user-${String(seq)}`, kind: 'user', title: '你', text }),
      }
    }
    case 'tool/call': {
      const callId = String(data.callId ?? `seq-${String(seq)}`)
      const name = typeof data.name === 'string' ? data.name : 'unknown'
      const args = data.arguments ?? {}
      return {
        ...state, busy: true, activity: `正在执行：${toolTitle(name)}`,
        items: upsert(state.items, {
          id: `tool-${callId}`, kind: 'tool', callId, toolName: name, title: toolTitle(name),
          text: toolSummary(name, args), detail: pretty(args), status: 'running',
        }),
      }
    }
    case 'tool/result': {
      const result = toolResultText(data)
      if (result === undefined) return state
      const previous = state.items.find(item => item.id === `tool-${result.callId}`)
      return {
        ...state, activity: result.error ? '工具执行失败' : '工具执行完成，DSH 正在继续…',
        items: upsert(state.items, {
          id: `tool-${result.callId}`, kind: 'tool', callId: result.callId,
          title: previous?.title ?? '工具调用',
          ...(previous?.toolName === undefined ? {} : { toolName: previous.toolName }),
          text: result.text,
          detail: result.detail, status: result.error ? 'error' : 'success',
        }),
      }
    }
    case 'llm/retry':
      return {
        ...state, busy: true, activity: '模型响应异常，正在重试…',
        items: upsert(state.items, {
          id: `notice-${String(seq)}`, kind: 'notice', title: '自动重试',
          text: '模型响应中断，DSH 正在自动重试。', status: 'running',
        }),
      }
    case 'turn/end': {
      const reason = record(data.reason)
      const kind = typeof reason?.kind === 'string' ? reason.kind : 'completed'
      const failed = kind !== 'completed'
      return {
        ...state, busy: false, activity: failed ? `本轮已结束：${kind}` : '本轮执行完成',
        items: state.items.map(item => item.status === 'streaming'
          ? { ...item, status: failed ? 'cancelled' : 'success' }
          : item.status === 'running' && item.kind !== 'tool'
            ? { ...item, status: failed ? 'cancelled' : 'success' }
            : item),
      }
    }
    default:
      return state
  }
}

/** Rebuild a user-facing timeline from a Session history page. */
export function replayTimeline(events: readonly unknown[]): TimelineState {
  let state = emptyTimeline
  for (const entry of events) {
    const wrapper = record(entry)
    state = applyTimelineEvent(state, wrapper?.event ?? entry)
  }
  return state
}

/** Add a local-only UI entry without fabricating a durable Session event. */
export function appendTimelineItem(state: TimelineState, item: TimelineItem): TimelineState {
  return { ...state, items: upsert(state.items, item) }
}
