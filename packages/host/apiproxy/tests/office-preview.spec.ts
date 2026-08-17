import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficePreviewError, OfficePreviewGrants } from '../src/office-preview.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function documentPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-office-preview-'))
  roots.push(root)
  const path = join(root, 'report.docx')
  await writeFile(path, 'original')
  return path
}

describe('OfficePreviewGrants', () => {
  it('requires a configured Document Server for DOCX', async () => {
    const path = await documentPath()
    await expect(new OfficePreviewGrants().prepare(path)).rejects.toMatchObject({
      reason: 'unavailable',
    } satisfies Partial<OfficePreviewError>)
  })

  it('prepares editor URLs and serves the granted document', async () => {
    const path = await documentPath()
    const grants = new OfficePreviewGrants({
      browserUrl: 'http://127.0.0.1:8080/',
      harnessUrl: 'http://host.docker.internal:3080/',
    })
    const prepared = await grants.prepare(path)
    expect(prepared).toMatchObject({
      kind: 'office',
      name: 'report.docx',
      apiUrl: 'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
      config: {
        documentType: 'word',
        document: {
          fileType: 'docx',
          title: 'report.docx',
          permissions: { edit: true, download: true },
        },
        editorConfig: {
          mode: 'edit',
          customization: {},
          user: { id: 'deepseek-harness', name: 'DeepSeek Harness' },
        },
      },
    })
    const token = prepared.config.document.key
    expect(prepared.config.document.url).toBe(`http://host.docker.internal:3080/api/office-preview/${token}/file`)
    expect(prepared.config.editorConfig.callbackUrl).toBe(`http://host.docker.internal:3080/api/office-preview/${token}/callback`)
    const response = await grants.file(token, new AbortController().signal)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('original')
  })

  it('writes completed edits back while acknowledging intermediate callbacks', async () => {
    const path = await documentPath()
    const grants = new OfficePreviewGrants({
      browserUrl: 'http://127.0.0.1:8080',
      harnessUrl: 'http://host.docker.internal:3080',
    })
    const prepared = await grants.prepare(path)
    const token = prepared.config.document.key
    const fetchMock = vi.fn(async () => new Response('edited'))
    vi.stubGlobal('fetch', fetchMock)

    const editing = await grants.callback(token, { status: 1 }, new AbortController().signal)
    expect(await editing.json()).toEqual({ error: 0 })
    expect(fetchMock).not.toHaveBeenCalled()

    const saved = await grants.callback(
      token,
      { status: 2, url: 'http://document-server/cache/report.docx' },
      new AbortController().signal,
    )
    expect(await saved.json()).toEqual({ error: 0 })
    expect(await readFile(path, 'utf8')).toBe('edited')
  })
})
