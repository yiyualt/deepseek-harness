import type { TimelineItem } from './timeline.ts'

function statusLabel(item: TimelineItem): string {
  if (item.status === 'running' || item.status === 'streaming') return '进行中'
  if (item.status === 'success') return '完成'
  if (item.status === 'error') return '失败'
  if (item.status === 'cancelled') return '已取消'
  return ''
}

function ToolCard({ item }: { readonly item: TimelineItem }) {
  return <article className={`tool-card ${item.status ?? ''}`}>
    <div className="tool-head">
      <span className="tool-indicator" aria-hidden="true" />
      <div className="tool-copy">
        <strong>{item.title}</strong>
        <span>{item.text}</span>
      </div>
      <span className="tool-status">{statusLabel(item)}</span>
    </div>
    {item.detail && <details className="tool-detail">
      <summary>查看参数与结果</summary>
      <pre>{item.detail}</pre>
    </details>}
  </article>
}

function ReasoningCard({ item }: { readonly item: TimelineItem }) {
  return <details className="reasoning-card" open={item.status === 'streaming' || item.status === 'running'}>
    <summary>
      <span className="thinking-dot" aria-hidden="true" />
      {item.status === 'streaming' ? '正在思考…' : item.title}
    </summary>
    <div>{item.text || '正在组织思路…'}</div>
  </details>
}

/** Render the compact event timeline inside the narrow Excel task pane. */
export function TimelineView({ items }: { readonly items: readonly TimelineItem[] }) {
  return <>
    {items.map((item) => {
      if (item.kind === 'tool') return <ToolCard key={item.id} item={item} />
      if (item.kind === 'reasoning') return <ReasoningCard key={item.id} item={item} />
      return <article key={item.id} className={`message ${item.kind} ${item.status ?? ''}`}>
        <div className="role">{item.title}</div>
        <div className="content">{item.text}</div>
      </article>
    })}
  </>
}
