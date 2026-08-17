import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ArtifactPreviewError, ArtifactPreviewGrants,
} from '../src/artifact-preview.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-artifact-preview-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function tokenFrom(url: string): string {
  const token = /^\/api\/artifact-preview\/([^/]+)\//.exec(url)?.[1]
  if (token === undefined) throw new Error(`preview URL has no token: ${url}`)
  return token
}

describe('ArtifactPreviewGrants', () => {
  it('serves the HTML entry and relative resources with inline response headers', async () => {
    const entry = join(root, 'site', 'report.html')
    const style = join(root, 'site', 'assets', 'style.css')
    await mkdir(dirname(style), { recursive: true })
    await writeFile(entry, '<link rel="stylesheet" href="assets/style.css"><h1>Preview</h1>')
    await writeFile(style, 'h1 { color: green; }')

    const grants = new ArtifactPreviewGrants()
    const grant = await grants.prepare(entry)
    const token = tokenFrom(grant.url)

    expect(grant.name).toBe('report.html')
    const html = await grants.response(token, 'report.html', new AbortController().signal)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(await html.text()).toContain('<h1>Preview</h1>')

    const css = await grants.response(token, 'assets/style.css', new AbortController().signal)
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await css.text()).toContain('color: green')
  })

  it('rejects unsupported, missing, and non-file entry points', async () => {
    const grants = new ArtifactPreviewGrants()
    await expect(grants.prepare(join(root, 'notes.txt'))).rejects.toMatchObject({
      reason: 'unsupported',
    } satisfies Partial<ArtifactPreviewError>)
    await expect(grants.prepare(join(root, 'missing.html'))).rejects.toMatchObject({
      reason: 'unavailable',
    } satisfies Partial<ArtifactPreviewError>)
    const directory = join(root, 'folder.html')
    await mkdir(directory)
    await expect(grants.prepare(directory)).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('keeps a grant inside its entry directory and rejects malformed requests', async () => {
    const entry = join(root, 'site', 'index.html')
    await mkdir(dirname(entry), { recursive: true })
    await writeFile(entry, '<h1>Inside</h1>')
    await writeFile(join(root, 'outside.css'), 'secret')
    const grants = new ArtifactPreviewGrants()
    const { url } = await grants.prepare(entry)
    const token = tokenFrom(url)
    const signal = new AbortController().signal

    expect((await grants.response('00000000-0000-4000-8000-000000000000', 'index.html', signal)).status)
      .toBe(404)
    expect((await grants.response(token, '%E0%A4%A', signal)).status).toBe(400)
    expect((await grants.response(token, '', signal)).status).toBe(404)
    expect((await grants.response(token, '%00', signal)).status).toBe(404)
    expect((await grants.response(token, '../outside.css', signal)).status).toBe(404)
    expect((await grants.response(token, 'missing.css', signal)).status).toBe(404)
    expect((await grants.response(token, '.', signal)).status).toBe(404)
  })

  it('maps an aborted resource read to the carrier cancellation status', async () => {
    const entry = join(root, 'index.html')
    await writeFile(entry, '<h1>Abort</h1>')
    const grants = new ArtifactPreviewGrants()
    const { url } = await grants.prepare(entry)
    const controller = new AbortController()
    controller.abort()

    expect((await grants.response(tokenFrom(url), 'index.html', controller.signal)).status).toBe(499)
  })
})
