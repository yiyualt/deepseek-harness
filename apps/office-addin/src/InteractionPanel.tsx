import { useMemo, useState } from 'react'

export interface QuestionOption {
  readonly label: string
  readonly description?: string
}

export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options?: QuestionOption[]
  readonly multiSelect?: boolean
}

export interface PendingQuestion {
  readonly rpcId: string
  readonly questions: QuestionItem[]
}

export interface PendingApproval {
  readonly rpcId: string
  readonly approvalId: string
  readonly toolName: string
  readonly reason?: string
}

export interface QuestionAnswer {
  readonly answers: Array<{ readonly id: string; readonly selected: string[]; readonly custom?: string }>
}

interface Draft {
  readonly selected: string[]
  readonly custom: string
}

function initialDrafts(questions: readonly QuestionItem[]): Record<string, Draft> {
  return Object.fromEntries(questions.map(question => [question.id, { selected: [], custom: '' }]))
}

function recommended(label: string): { readonly text: string; readonly recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return { text: label.replace(suffix, ''), recommended: suffix.test(label) }
}

/** Render and answer one host-initiated ask_user_question interaction. */
export function QuestionPanel({ request, onAnswer, onCancel }: {
  readonly request: PendingQuestion
  readonly onAnswer: (answer: QuestionAnswer) => Promise<void>
  readonly onCancel: () => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => initialDrafts(request.questions))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const complete = useMemo(() => request.questions.every((question) => {
    const draft = drafts[question.id]
    return draft !== undefined && (draft.selected.length > 0 || draft.custom.trim() !== '')
  }), [drafts, request.questions])

  const choose = (question: QuestionItem, label: string): void => {
    setDrafts((current) => {
      const previous = current[question.id] ?? { selected: [], custom: '' }
      const selected = question.multiSelect === true
        ? previous.selected.includes(label)
          ? previous.selected.filter(value => value !== label)
          : [...previous.selected, label]
        : [label]
      return { ...current, [question.id]: { selected, custom: question.multiSelect === true ? previous.custom : '' } }
    })
    setError('')
  }

  const submit = (): void => {
    if (!complete) {
      setError('请回答所有问题后再继续。')
      return
    }
    const answer: QuestionAnswer = {
      answers: request.questions.map((question) => {
        const draft = drafts[question.id] ?? { selected: [], custom: '' }
        const custom = draft.custom.trim()
        return {
          id: question.id,
          selected: question.multiSelect === true || custom === '' ? draft.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setSubmitting(true)
    setError('')
    void onAnswer(answer).catch((cause: unknown) => {
      setSubmitting(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const cancel = (): void => {
    setSubmitting(true)
    setError('')
    void onCancel().catch((cause: unknown) => {
      setSubmitting(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return <section className="interaction-panel" aria-label="Agent 正在等待你的回答">
    <header><span>需要你的回答</span><strong>Agent 暂停等待中</strong></header>
    {request.questions.map((question) => {
      const draft = drafts[question.id] ?? { selected: [], custom: '' }
      return <fieldset key={question.id} disabled={submitting}>
        {question.header && <div className="question-header">{question.header}</div>}
        <legend>{question.question}</legend>
        {question.detail && <p className="question-detail">{question.detail}</p>}
        <div className="question-options">
          {(question.options ?? []).map((option) => {
            const label = recommended(option.label)
            const selected = draft.selected.includes(option.label)
            return <button
              type="button" key={option.label} className={selected ? 'selected' : ''}
              role={question.multiSelect === true ? 'checkbox' : 'radio'} aria-checked={selected}
              onClick={() => { choose(question, option.label) }}
            >
              <span className="choice-mark">{question.multiSelect === true ? (selected ? '✓' : '') : selected ? '●' : '○'}</span>
              <span><b>{label.text}</b>{label.recommended && <em>推荐</em>}{option.description && <small>{option.description}</small>}</span>
            </button>
          })}
        </div>
        <input
          type="text" value={draft.custom} placeholder={(question.options?.length ?? 0) > 0 ? '其他答案…' : '输入你的回答…'}
          onChange={(event) => {
            const custom = event.target.value
            setDrafts(current => ({
              ...current,
              [question.id]: {
                selected: question.multiSelect === true ? current[question.id]?.selected ?? [] : [],
                custom,
              },
            }))
            setError('')
          }}
        />
      </fieldset>
    })}
    {error && <div className="interaction-error" role="alert">{error}</div>}
    <footer>
      <button type="button" className="secondary" disabled={submitting} onClick={cancel}>取消本次任务</button>
      <button type="button" className="primary" disabled={submitting || !complete} onClick={submit}>
        {submitting ? '正在提交…' : '提交并继续'}
      </button>
    </footer>
  </section>
}

/** Render one approval request before a protected tool executes. */
export function ApprovalPanel({ request, onDecision }: {
  readonly request: PendingApproval
  readonly onDecision: (outcome: 'allowed-once' | 'rejected') => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const decide = (outcome: 'allowed-once' | 'rejected'): void => {
    setSubmitting(true)
    setError('')
    void onDecision(outcome).catch((cause: unknown) => {
      setSubmitting(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  return <section className="interaction-panel approval-panel" aria-label="工具执行审批">
    <header><span>需要你的确认</span><strong>工具执行审批</strong></header>
    <p><b>{request.toolName}</b> 请求执行。</p>
    {request.reason && <p className="question-detail">{request.reason}</p>}
    {error && <div className="interaction-error" role="alert">{error}</div>}
    <footer>
      <button type="button" className="secondary" disabled={submitting} onClick={() => { decide('rejected') }}>拒绝</button>
      <button type="button" className="primary" disabled={submitting} onClick={() => { decide('allowed-once') }}>
        {submitting ? '正在提交…' : '允许一次'}
      </button>
    </footer>
  </section>
}
