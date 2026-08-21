import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownPreviewError, MarkdownPreviewGrants } from '../src/markdown-preview.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-markdown-preview-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MarkdownPreviewGrants', () => {
  it('reads Markdown and saves through the current revision', async () => {
    const path = join(root, 'notes.md')
    await writeFile(path, '# One\n')
    const grants = new MarkdownPreviewGrants()
    const prepared = await grants.prepare(path)

    expect(prepared).toMatchObject({ kind: 'markdown', name: 'notes.md', content: '# One\n' })
    expect(prepared.grantId).toMatch(/^[0-9a-f-]{36}$/)
    expect(prepared.revision).toHaveLength(64)

    const saved = await grants.save(prepared.grantId, '# Two\n', prepared.revision)
    expect(saved.revision).toHaveLength(64)
    expect(saved.revision).not.toBe(prepared.revision)
    expect(await readFile(path, 'utf8')).toBe('# Two\n')
  })

  it('rejects unsupported files, stale revisions, and unknown grants', async () => {
    const path = join(root, 'notes.md')
    await writeFile(path, '# One\n')
    const grants = new MarkdownPreviewGrants()
    await expect(grants.prepare(join(root, 'notes.txt'))).rejects.toMatchObject({ reason: 'unsupported' })

    const prepared = await grants.prepare(path)
    const canonicalPath = await realpath(path)
    await writeFile(path, '# External\n')
    await expect(grants.save(prepared.grantId, '# Browser\n', prepared.revision)).rejects.toMatchObject({
      reason: 'conflict',
      path: canonicalPath,
    } satisfies Partial<MarkdownPreviewError>)
    expect(await readFile(path, 'utf8')).toBe('# External\n')

    await expect(grants.save('missing', '# Missing\n', prepared.revision)).rejects.toMatchObject({
      reason: 'unavailable',
    })
  })
})
