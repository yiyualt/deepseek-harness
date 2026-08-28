import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-artifact-edit-api-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('artifact save awareness', () => {
  async function context(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LlmRuntime)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    return ctx
  }

  it('records a durable human edit only after the granted file saves', async () => {
    const ctx = await context()
    const session = ctx.sessions.create(SessionId('artifact-save-session'), { meta: { cwd: root } })
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test' }),
      cwd: root,
    })
    const path = join(root, 'draft.html')
    await writeFile(path, '<h1>Original</h1>')
    const prepared = await api.host.prepareArtifactPreview({
      rpcId: RpcId('prepare-artifact-edit'),
      payload: { path },
    })
    expect(prepared.result.ok).toBe(true)
    if (!prepared.result.ok || prepared.result.value.kind !== 'html') return

    const saved = await api.host.saveHtmlArtifact({
      rpcId: RpcId('save-artifact-edit'),
      payload: {
        sessionId: session.id,
        grantId: prepared.result.value.grantId,
        content: '<h1>Human edit</h1>',
        revision: prepared.result.value.revision,
      },
    })

    expect(saved.result.ok).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('<h1>Human edit</h1>')
    expect(session.events.findLast(event => event.type === 'artifact/edited')).toMatchObject({
      data: {
        path: await realpath(path),
        format: 'html',
        revision: saved.result.ok ? saved.result.value.revision : '',
      },
    })
  })

  it('does not alter the file when the addressed session is unavailable', async () => {
    const ctx = await context()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test' }),
      cwd: root,
    })
    const path = join(root, 'draft.html')
    await writeFile(path, '<h1>Original</h1>')
    const prepared = await api.host.prepareArtifactPreview({
      rpcId: RpcId('prepare-missing-session'),
      payload: { path },
    })
    if (!prepared.result.ok || prepared.result.value.kind !== 'html') throw new Error('HTML preparation failed')

    const saved = await api.host.saveHtmlArtifact({
      rpcId: RpcId('save-missing-session'),
      payload: {
        sessionId: SessionId('missing-session'),
        grantId: prepared.result.value.grantId,
        content: '<h1>Must not save</h1>',
        revision: prepared.result.value.revision,
      },
    })

    expect(saved.result.ok).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('<h1>Original</h1>')
  })
})
