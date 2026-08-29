import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectExcelBridge } from './excel-bridge.ts'
import { openMux, respond, rpc } from './dsh-client.ts'
import {
  ApprovalPanel, QuestionPanel,
  type PendingApproval, type PendingQuestion, type QuestionAnswer, type QuestionItem,
} from './InteractionPanel.tsx'
import { TimelineView } from './TimelineView.tsx'
import {
  appendTimelineItem, applyTimelineEvent, emptyTimeline, replayTimeline,
  type TimelineState,
} from './timeline.ts'

interface SessionCreateResult { readonly sessionId: string }
interface HistoryResult { readonly events: Array<{ readonly event: Record<string, unknown> }> }

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function questionItems(value: unknown): QuestionItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const items: QuestionItem[] = []
  for (const candidate of value) {
    const row = record(candidate)
    if (typeof row?.id !== 'string' || typeof row.question !== 'string') return undefined
    const options = Array.isArray(row.options)
      ? row.options.flatMap((option) => {
        const item = record(option)
        return typeof item?.label === 'string'
          ? [{ label: item.label, ...(typeof item.description === 'string' ? { description: item.description } : {}) }]
          : []
      })
      : undefined
    items.push({
      id: row.id,
      question: row.question,
      ...(typeof row.detail === 'string' ? { detail: row.detail } : {}),
      ...(typeof row.header === 'string' ? { header: row.header } : {}),
      ...(options === undefined ? {} : { options }),
      ...(row.multiSelect === true ? { multiSelect: true } : {}),
    })
  }
  return items
}

async function workbookIdentity(): Promise<{ id: string; name: string }> {
  const settings = Office.context.document.settings
  const existing: unknown = settings.get('dsh.workbookId')
  const id = typeof existing === 'string' && existing.length > 0 ? existing : crypto.randomUUID()
  if (existing !== id) {
    settings.set('dsh.workbookId', id)
    await new Promise<void>((resolve, reject) => {
      settings.saveAsync((result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve()
        else reject(new Error(result.error.message))
      })
    })
  }
  const url: unknown = Office.context.document.url
  const name = typeof url === 'string' && url.length > 0
    ? decodeURIComponent(url.split('/').pop() ?? 'Excel Workbook')
    : 'Excel Workbook'
  return { id, name }
}

export function App() {
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline)
  const [draft, setDraft] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState('正在连接 DSH…')
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [muxConnected, setMuxConnected] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const activate = useCallback(async (forceNew = false) => {
    setStatus('正在创建 DSH 会话…')
    setPendingQuestion(null)
    setPendingApproval(null)
    const settings = Office.context.document.settings
    const cached: unknown = settings.get('dsh.sessionId')
    let next = !forceNew && typeof cached === 'string' ? cached : ''
    if (next) {
      try {
        const history = await rpc<HistoryResult>('session.history', { sessionId: next, maxMessages: 200 })
        setTimeline(replayTimeline(history.events))
      } catch {
        next = ''
      }
    }
    if (!next) {
      const created = await rpc<SessionCreateResult>('session.create', {})
      next = created.sessionId
      settings.set('dsh.sessionId', next)
      await new Promise<void>((resolve, reject) => {
        settings.saveAsync((result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve()
          else reject(new Error(result.error.message))
        })
      })
      setTimeline(emptyTimeline)
    }
    setSessionId(next)
    setStatus('DSH 会话已连接')
  }, [])

  useEffect(() => {
    void activate().catch((error: unknown) => { setStatus(error instanceof Error ? error.message : String(error)) })
  }, [activate])

  useEffect(() => {
    if (!sessionId) return
    return openMux(({ rpcId, payload }) => {
      if (payload.sessionId !== sessionId) return
      switch (payload.type) {
        case 'session/event':
          setTimeline(current => applyTimelineEvent(current, payload.event))
          break
        case 'question/requested': {
          const questions = questionItems(payload.questions)
          if (questions === undefined) {
            setStatus('DSH 返回了无法识别的提问格式')
            return
          }
          setPendingQuestion({ rpcId, questions })
          setTimeline(current => ({ ...current, busy: true, activity: 'Agent 正在等待你的回答' }))
          break
        }
        case 'question/resolved':
          setPendingQuestion(current => current?.rpcId === payload.questionRpcId ? null : current)
          setTimeline(current => ({ ...current, busy: true, activity: '已提交回答，DSH 正在继续…' }))
          break
        case 'approval/requested':
          if (typeof payload.approvalId === 'string' && typeof payload.toolName === 'string') {
            setPendingApproval({
              rpcId, approvalId: payload.approvalId, toolName: payload.toolName,
              ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
            })
            setTimeline(current => ({ ...current, busy: true, activity: '工具正在等待你的确认' }))
          }
          break
        case 'approval/resolved':
          setPendingApproval(current => current?.approvalId === payload.approvalId ? null : current)
          setTimeline(current => ({ ...current, busy: true, activity: '确认已提交，DSH 正在继续…' }))
          break
        case 'stream/error': {
          const error = record(payload.error)
          const message = typeof error?.message === 'string' ? error.message : 'DSH 事件流发生错误'
          setStatus(message)
          setTimeline(current => ({
            ...appendTimelineItem(current, {
              id: `stream-error-${crypto.randomUUID()}`, kind: 'notice', title: '连接错误',
              text: message, status: 'error',
            }),
            busy: false,
            activity: '事件流已中断',
          }))
          break
        }
      }
    }, (connected) => {
      setMuxConnected(connected)
      if (!connected) setStatus('DSH 事件流已断开，正在自动重连…')
    })
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    let stop = (): void => {}
    void workbookIdentity().then((workbook) => {
      stop = connectExcelBridge(sessionId, workbook.id, workbook.name, (connected, message) => {
        setBridgeConnected(connected)
        setStatus(message)
      })
    }).catch((error: unknown) => { setStatus(error instanceof Error ? error.message : String(error)) })
    return () => { stop() }
  }, [sessionId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [timeline.items, pendingQuestion, pendingApproval])

  const interactionPending = pendingQuestion !== null || pendingApproval !== null
  const fullyConnected = bridgeConnected && muxConnected
  const canSend = useMemo(
    () => draft.trim().length > 0 && sessionId.length > 0 && fullyConnected && !timeline.busy && !interactionPending,
    [draft, fullyConnected, interactionPending, sessionId, timeline.busy],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sessionId || timeline.busy || interactionPending) return
    setDraft('')
    setTimeline(current => ({ ...current, busy: true, activity: '请求已提交，等待 DSH 响应…' }))
    try {
      await rpc('session.prompt', {
        sessionId, mode: 'queue', content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTimeline(current => ({
        ...appendTimelineItem(current, {
          id: `send-error-${crypto.randomUUID()}`, kind: 'notice', title: '发送失败', text: message, status: 'error',
        }),
        busy: false,
        activity: '发送失败',
      }))
    }
  }, [draft, interactionPending, sessionId, timeline.busy])

  const answerQuestion = async (answer: QuestionAnswer): Promise<void> => {
    if (pendingQuestion === null) throw new Error('当前没有待回答的问题')
    await respond(pendingQuestion.rpcId, { ok: true, value: { sessionId, answer } })
  }

  const cancelQuestion = async (): Promise<void> => {
    if (pendingQuestion === null) throw new Error('当前没有待回答的问题')
    await respond(pendingQuestion.rpcId, {
      ok: false,
      error: { code: 'cancelled', message: '用户在 Excel 中取消了问题' },
    })
  }

  const decideApproval = async (outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    if (pendingApproval === null) throw new Error('当前没有待确认的工具')
    await respond(pendingApproval.rpcId, {
      ok: true,
      value: { sessionId, approvalId: pendingApproval.approvalId, outcome },
    })
  }

  return <main className="app">
    <header className="header">
      <div><h1>DeepSeek Harness</h1><p>{status}</p></div>
      <button className="ghost" disabled={timeline.busy} onClick={() => { void activate(true) }}>新会话</button>
    </header>
    <div className={`connection ${fullyConnected ? 'ok' : 'bad'}`}>
      <span />{fullyConnected ? '当前工作簿可由 Agent 操作' : bridgeConnected ? '正在连接 DSH 事件流' : '工作簿执行通道未连接'}
    </div>
    <div className={`activity ${timeline.busy ? 'busy' : ''}`}>
      <span aria-hidden="true" />{timeline.activity}
    </div>
    <section className="messages">
      {timeline.items.length === 0 && <div className="welcome">
        <h2>在 Excel 中使用 DSH</h2>
        <p>你可以说：“检查当前工作簿”，或“把 Sheet1 的 A1 写成销售额”。</p>
      </div>}
      <TimelineView items={timeline.items} />
      <div ref={endRef} />
    </section>
    {pendingQuestion !== null
      ? <div className="interaction-dock"><QuestionPanel
        key={pendingQuestion.rpcId} request={pendingQuestion}
        onAnswer={answerQuestion} onCancel={cancelQuestion}
      /></div>
      : pendingApproval !== null
        ? <div className="interaction-dock"><ApprovalPanel
          key={pendingApproval.rpcId} request={pendingApproval} onDecision={decideApproval}
        /></div>
        : <footer className="composer">
          <textarea value={draft} onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
            }} placeholder="告诉 DSH 你想在当前工作簿中完成什么…" />
          <button disabled={!canSend} onClick={() => { void send() }}>{timeline.busy ? '执行中' : '发送'}</button>
        </footer>}
  </main>
}
