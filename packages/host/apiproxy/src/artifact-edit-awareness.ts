/** Durable human artifact edits and their model-facing delivery. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

/** Default maximum edit facts represented in one model context message. */
export const DEFAULT_ARTIFACT_EDIT_NOTICE_MAX_ITEMS = 20

/** Artifact formats whose built-in editors save to the shared workspace. */
export type HumanEditedArtifactFormat = 'html' | 'markdown' | 'docx' | 'xlsx' | 'pptx'

/** Durable source metadata for one batch of delivered human edits. */
export interface ArtifactEditMessageSource {
  readonly kind: 'artifact-edit'
  readonly form: 'notice'
  readonly summary: string
  readonly throughSeq: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Human edits saved through a built-in workspace artifact editor. */
    'artifact-edit': ArtifactEditMessageSource
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One successful human-authored artifact save. The following model step
     * receives a logged `artifact-edit` context covering this event.
     */
    'artifact/edited': {
      path: string
      format: HumanEditedArtifactFormat
      revision: string
    }
  }
}

interface PendingArtifactEdit {
  readonly seq: number
  readonly path: string
  readonly format: HumanEditedArtifactFormat
}

function deliveredThrough(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'user/message' && event.data.source.kind === 'artifact-edit') {
      return event.data.source.throughSeq
    }
  }
  return -1
}

function pendingEdits(session: Session, maxItems: number): PendingArtifactEdit[] {
  const throughSeq = deliveredThrough(session.events)
  const pending: PendingArtifactEdit[] = []
  for (const event of session.events) {
    if (event.seq <= throughSeq || event.type !== 'artifact/edited') continue
    pending.push({ seq: event.seq, path: event.data.path, format: event.data.format })
    if (pending.length === maxItems) break
  }
  return pending
}

function renderEditNotice(edits: readonly PendingArtifactEdit[]): string {
  const lines = edits.map(edit => `- ${edit.format.toUpperCase()}: ${edit.path}`)
  return [
    '<system-reminder>',
    'The user saved changes to these local workspace artifacts:',
    ...lines,
    'The files are shared human-agent working state. Treat their current on-disk contents as authoritative and re-read a file before editing it or answering about its contents.',
    '</system-reminder>',
  ].join('\n')
}

/**
 * Append one human edit fact after its file replacement commits.
 * @param session Session whose artifact editor accepted the save.
 * @param path Canonical saved file path from the opaque edit grant.
 * @param format Saved artifact format.
 * @param revision Revision produced by the committed save.
 * @returns The appended durable event.
 */
export function appendArtifactEdit(
  session: Session,
  path: string,
  format: HumanEditedArtifactFormat,
  revision: string,
): SessionEvent<'artifact/edited'> {
  return session.append('artifact/edited', { path, format, revision })
}

/**
 * Derive the next bounded model context from durable human edit facts.
 * @param session Session whose log owns the edit and delivery facts.
 * @param maxItems Maximum edit events represented by this message.
 * @returns A context message, or undefined when every edit is delivered.
 */
export function artifactEditMessage(session: Session, maxItems: number): UserMessage | undefined {
  const edits = pendingEdits(session, maxItems)
  if (edits.length === 0) return undefined
  const last = edits.at(-1)
  if (last === undefined) return undefined
  const uniquePaths = new Set(edits.map(edit => edit.path)).size
  const source: ArtifactEditMessageSource = {
    kind: 'artifact-edit',
    form: 'notice',
    summary: uniquePaths === 1 ? '1 edited artifact' : `${String(uniquePaths)} edited artifacts`,
    throughSeq: last.seq,
  }
  return createUserMessage({
    content: [{ type: 'text', text: renderEditNotice(edits) }],
    source,
  })
}

/**
 * Register delivery of undelivered human artifact edits at model pre-step.
 * @param ctx Host plugin context receiving agent lifecycle events.
 * @param maxItems Maximum durable edit events represented by one context message.
 * @returns Listener disposer.
 */
export function installArtifactEditAwareness(ctx: Context, maxItems: number): () => void {
  return ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const message = artifactEditMessage(agent.session, maxItems)
    if (message === undefined) return decision
    return { kind: 'enter', messages: [...decision.messages, message] }
  })
}
