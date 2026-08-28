import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { appendArtifactEdit } from '../src/artifact-edit-awareness.ts'
import * as ApiProxyInvariant from '../src/invariant.ts'

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ApiProxyInvariant)
  return ctx
}

describe('host-apiproxy invariant companion', () => {
  it('accepts a valid artifact edit and its later delivery message', async () => {
    const ctx = await context()
    try {
      const session = Session.create(SessionId('artifact-invariant-valid'))
      const edited = appendArtifactEdit(session, '/workspace/report.html', 'html', 'a'.repeat(64))
      expect(() => { ctx.emit('session/event', session, edited) }).not.toThrow()
      const notice = session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'artifact notice' }],
        source: { kind: 'artifact-edit', form: 'notice', summary: '1 edited artifact', throughSeq: edited.seq },
      }), { surfaceOp: 'append' })
      expect(() => { ctx.emit('session/event', session, notice) }).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects an invalid revision and a delivery without an earlier edit', async () => {
    const ctx = await context()
    try {
      const session = Session.create(SessionId('artifact-invariant-invalid'))
      const edited = appendArtifactEdit(session, '/workspace/report.html', 'html', 'not-a-revision')
      expect(() => { ctx.emit('session/event', session, edited) })
        .toThrow(/lowercase SHA-256 revision/u)

      const notice = session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'orphan artifact notice' }],
        source: { kind: 'artifact-edit', form: 'notice', summary: '1 edited artifact', throughSeq: 99 },
      }), { surfaceOp: 'append' })
      expect(() => { ctx.emit('session/event', session, notice) })
        .toThrow(/must reference an earlier artifact\/edited event/u)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
