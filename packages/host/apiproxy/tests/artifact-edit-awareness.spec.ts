import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  appendArtifactEdit,
  artifactEditMessage,
  type ArtifactEditMessageSource,
} from '../src/artifact-edit-awareness.ts'

function sourceOf(session: Session, maxItems: number): ArtifactEditMessageSource | undefined {
  const source = artifactEditMessage(session, maxItems)?.source
  return source?.kind === 'artifact-edit' ? source : undefined
}

function textOf(message: ReturnType<typeof artifactEditMessage>): string {
  return message?.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('') ?? ''
}

describe('artifact edit awareness', () => {
  it('renders successful human saves as bounded model context', () => {
    const session = Session.create(SessionId('artifact-awareness'))
    appendArtifactEdit(session, '/workspace/report.html', 'html', 'a'.repeat(64))
    appendArtifactEdit(session, '/workspace/brief.docx', 'docx', 'b'.repeat(64))
    appendArtifactEdit(session, '/workspace/table.xlsx', 'xlsx', 'c'.repeat(64))

    const message = artifactEditMessage(session, 2)
    expect(textOf(message)).toContain('- HTML: /workspace/report.html\n- DOCX: /workspace/brief.docx')
    expect(textOf(message)).not.toContain('/workspace/table.xlsx')
    expect(sourceOf(session, 2)).toMatchObject({
      kind: 'artifact-edit',
      form: 'notice',
      summary: '2 edited artifacts',
      throughSeq: 1,
    })
  })

  it('continues after the latest delivered edit and then settles', () => {
    const session = Session.create(SessionId('artifact-awareness-delivery'))
    appendArtifactEdit(session, '/workspace/one.md', 'markdown', 'a'.repeat(64))
    appendArtifactEdit(session, '/workspace/two.pptx', 'pptx', 'b'.repeat(64))
    const first = artifactEditMessage(session, 1)
    if (first === undefined || first.source.kind !== 'artifact-edit') throw new Error('missing first artifact context')
    session.append('user/message', createUserMessage({ content: first.content, source: first.source }), { surfaceOp: 'append' })

    const second = artifactEditMessage(session, 1)
    expect(textOf(second)).toContain('- PPTX: /workspace/two.pptx')
    if (second === undefined || second.source.kind !== 'artifact-edit') throw new Error('missing second artifact context')
    session.append('user/message', createUserMessage({ content: second.content, source: second.source }), { surfaceOp: 'append' })

    expect(artifactEditMessage(session, 1)).toBeUndefined()
  })

  it('keeps repeated saves as one-path provenance without losing their sequence', () => {
    const session = Session.create(SessionId('artifact-awareness-repeat'))
    appendArtifactEdit(session, '/workspace/draft.md', 'markdown', 'a'.repeat(64))
    appendArtifactEdit(session, '/workspace/draft.md', 'markdown', 'b'.repeat(64))

    expect(sourceOf(session, 20)).toMatchObject({
      summary: '1 edited artifact',
      throughSeq: 1,
    })
  })
})
