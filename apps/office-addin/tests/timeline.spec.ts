import { describe, expect, it } from 'vitest'
import { parseMuxMessage } from '../src/dsh-client.ts'
import { applyTimelineEvent, emptyTimeline, replayTimeline } from '../src/timeline.ts'

function event(seq: number, type: string, data: Record<string, unknown>) {
  return { seq, time: seq, type, data }
}

describe('Excel conversation timeline', () => {
  it('shows streamed reasoning and provider block-end text', () => {
    let state = applyTimelineEvent(emptyTimeline, event(1, 'assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '先检查需求' },
    }))
    state = applyTimelineEvent(state, event(2, 'assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'block-end', index: 1, block: { type: 'text', text: '你好！有什么可以帮你？' } },
    }))

    expect(state.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reasoning', text: '先检查需求', status: 'streaming' }),
      expect.objectContaining({ kind: 'assistant', text: '你好！有什么可以帮你？', status: 'success' }),
    ]))
  })

  it('replaces partial text with the finalized assistant message and settles the turn', () => {
    let state = applyTimelineEvent(emptyTimeline, event(1, 'assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你' },
    }))
    state = applyTimelineEvent(state, event(2, 'assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: '你好！' }] },
    }))
    state = applyTimelineEvent(state, event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))

    expect(state.items.filter(item => item.kind === 'assistant')).toEqual([
      expect.objectContaining({ text: '你好！', status: 'success' }),
    ])
    expect(state.busy).toBe(false)
    expect(state.activity).toBe('本轮执行完成')
  })

  it('renders a tool lifecycle with arguments and result', () => {
    let state = applyTimelineEvent(emptyTimeline, event(1, 'tool/call', {
      turn: 1, step: 1, callId: 'call-1', name: 'excel_write_range',
      arguments: '{"sheet":"Sheet1","address":"A1","values":[[1]]}',
    }))
    expect(state.items[0]).toMatchObject({
      kind: 'tool', title: '写入 Excel 区域', text: '写入 Sheet1!A1', status: 'running',
    })

    state = applyTimelineEvent(state, event(2, 'tool/result', {
      turn: 1, step: 1,
      message: {
        source: { callId: 'call-1' },
        content: [{ type: 'tool-result', content: [{ type: 'text', text: '已写入 1 个单元格' }] }],
      },
    }))
    expect(state.items[0]).toMatchObject({ text: '已写入 1 个单元格', status: 'success' })
  })

  it('replays user, reasoning, and final answer from history', () => {
    const state = replayTimeline([
      { event: event(1, 'user/message', {
        content: [{ type: 'text', text: '你好' }], source: { kind: 'user' },
      }) },
      { event: event(2, 'assistant/message', {
        turn: 1, step: 1,
        message: { content: [{ type: 'reasoning', text: '礼貌回应' }, { type: 'text', text: '你好！' }] },
      }) },
      { event: event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }) },
    ])
    expect(state.items.map(item => [item.kind, item.text])).toEqual([
      ['user', '你好'], ['reasoning', '礼貌回应'], ['assistant', '你好！'],
    ])
  })

  it('does not render model context injections as user messages', () => {
    const state = replayTimeline([
      { event: event(1, 'user/message', {
        content: [{ type: 'text', text: '<system-reminder>workspace instructions</system-reminder>' }],
        source: { kind: 'agent-instructions', form: 'instructions' },
      }) },
      { event: event(2, 'user/message', {
        content: [{ type: 'text', text: 'Current runtime context' }],
        source: { kind: 'runtime-context' },
      }) },
      { event: event(3, 'user/message', {
        content: [{ type: 'text', text: '你好' }], source: { kind: 'user' },
      }) },
    ])

    expect(state.items).toEqual([
      expect.objectContaining({ kind: 'user', text: '你好' }),
    ])
  })
})

describe('DSH mux parser', () => {
  it('keeps the server request rpcId needed to answer a question', () => {
    const envelope = parseMuxMessage('{"type":"server-request","rpcId":"q-1","payload":{"type":"question/requested","sessionId":"s1","questions":[]}}')
    expect(envelope).toEqual({
      rpcId: 'q-1',
      payload: { type: 'question/requested', sessionId: 's1', questions: [] },
    })
  })
})
