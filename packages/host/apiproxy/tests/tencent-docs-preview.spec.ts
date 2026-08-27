import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TencentDocsPreviewError, TencentDocsPreviewGrants,
} from '../src/tencent-docs-preview.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function documentPath(name = 'report.pdf'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tencent-docs-preview-'))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, '0123456789')
  return path
}

function signature(appId: string, secret: string, nonce: string, timestamp: number): string {
  return createHash('sha1')
    .update(`app_id=${appId}&app_secret=${secret}&nonce=${nonce}&timestamp=${String(timestamp)}`)
    .digest('hex')
}

describe('TencentDocsPreviewGrants', () => {
  it('requires deployment credentials and a supported regular file', async () => {
    await expect(new TencentDocsPreviewGrants().prepare(await documentPath())).rejects.toMatchObject({
      reason: 'unavailable',
    } satisfies Partial<TencentDocsPreviewError>)
    await expect(new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve('secret'),
    }).prepare(await documentPath('archive.zip'))).rejects.toMatchObject({
      reason: 'unsupported',
    } satisfies Partial<TencentDocsPreviewError>)
    await expect(new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve(undefined),
    }).prepare(await documentPath())).rejects.toMatchObject({ reason: 'unavailable' })
    const missing = join(await mkdtemp(join(tmpdir(), 'dsh-tencent-docs-missing-')), 'missing.pdf')
    roots.push(missing.slice(0, missing.lastIndexOf('/')))
    await expect(new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve('secret'),
    }).prepare(missing)).rejects.toMatchObject({ reason: 'unavailable' })
    const directory = await documentPath('folder.pdf')
    await unlink(directory)
    await mkdir(directory)
    await expect(new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve('secret'),
    }).prepare(directory)).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('prepares browser-safe WebSDK fields and answers signed callbacks', async () => {
    const path = await documentPath()
    const grants = new TencentDocsPreviewGrants({
      appId: 'app-123',
      publicUrl: 'https://harness.example/',
      resolveAppSecret: () => Promise.resolve('top-secret'),
    })
    const prepared = await grants.prepare(path)
    expect(prepared).toMatchObject({
      kind: 'tencent-docs',
      name: 'report.pdf',
      scriptUrl: 'https://cdn.addon.tencentsuite.com/lib/web-sdk/global.js',
      config: {
        appId: 'app-123', officeType: 'pdf', mode: 'simple',
      },
    })
    expect(JSON.stringify(prepared)).not.toContain('top-secret')

    const custom = await new TencentDocsPreviewGrants({
      appId: 'app-123', publicUrl: 'https://harness.example', sdkUrl: 'https://sdk.example/web.js',
      resolveAppSecret: () => Promise.resolve('top-secret'),
    }).prepare(path)
    expect(custom.scriptUrl).toBe('https://sdk.example/web.js')

    const headers = {
      appId: prepared.config.appId,
      nonce: prepared.config.signature.nonce,
      timestamp: String(prepared.config.signature.timeStamp),
      signature: signature(
        prepared.config.appId,
        'top-secret',
        prepared.config.signature.nonce,
        prepared.config.signature.timeStamp,
      ),
      fileToken: prepared.config.fileToken,
    }
    const permission = await grants.callback(prepared.config.fileId, 'permission', headers)
    expect(await permission.json()).toEqual({
      code: 0,
      message: '',
      data: { user_id: 'deepseek-harness', read: true, copy: false, comment: false, print: false },
    })
    const info = await grants.callback(prepared.config.fileId, 'file-info', headers)
    expect(await info.json()).toMatchObject({ code: 0, data: { name: 'report.pdf', size: 10 } })
    const watermark = await grants.callback(prepared.config.fileId, 'watermark', headers)
    expect(await watermark.json()).toEqual({ code: 0, message: '', data: { type: 0, value: '' } })

    const download = await grants.callback(prepared.config.fileId, 'download-info', headers)
    const downloadBody = await download.json() as { data: { url: string } }
    const match = /\/content\/([^/]+)\/([^/]+)$/.exec(downloadBody.data.url)
    expect(match?.[1]).toBe(prepared.config.fileId)
    const full = await grants.file(match?.[1] ?? '', match?.[2] ?? '', undefined, new AbortController().signal)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(await full.text()).toBe('0123456789')
    const partial = await grants.file(match?.[1] ?? '', match?.[2] ?? '', 'bytes=2-5', new AbortController().signal)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await partial.text()).toBe('2345')
  })

  it('rejects invalid callback credentials and invalid byte ranges', async () => {
    const grants = new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve('secret'),
    })
    const prepared = await grants.prepare(await documentPath())
    const failed = await grants.callback(prepared.config.fileId, 'permission', {
      appId: 'app', nonce: 'nonce', timestamp: String(Math.floor(Date.now() / 1000)),
      signature: '0'.repeat(40), fileToken: prepared.config.fileToken,
    })
    expect(await failed.json()).toEqual({ code: 10006, message: 'signature verification failed' })

    const headers = {
      appId: 'app',
      nonce: prepared.config.signature.nonce,
      timestamp: String(prepared.config.signature.timeStamp),
      signature: signature('app', 'secret', prepared.config.signature.nonce, prepared.config.signature.timeStamp),
      fileToken: 'wrong',
    }
    const tokenFailure = await grants.callback(prepared.config.fileId, 'permission', headers)
    expect(await tokenFailure.json()).toEqual({ code: 10001, message: 'file token is invalid' })

    const validHeaders = { ...headers, fileToken: prepared.config.fileToken }
    const download = await grants.callback(prepared.config.fileId, 'download-info', validHeaders)
    const body = await download.json() as { data: { url: string } }
    const match = /\/content\/([^/]+)\/([^/]+)$/.exec(body.data.url)
    const invalidRange = await grants.file(
      match?.[1] ?? '', match?.[2] ?? '', 'bytes=20-30', new AbortController().signal,
    )
    expect(invalidRange.status).toBe(416)
    expect(invalidRange.headers.get('content-range')).toBe('bytes */10')
  })

  it('rejects missing, stale, and mismatched callback authentication', async () => {
    let secret: string | undefined = 'secret'
    const grants = new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve(secret),
    })
    const prepared = await grants.prepare(await documentPath())
    const now = Math.floor(Date.now() / 1000)
    const valid = {
      appId: 'app', nonce: 'nonce', timestamp: String(now), signature: signature('app', 'secret', 'nonce', now),
      fileToken: prepared.config.fileToken,
    }
    expect(await (await grants.callback('missing', 'permission', valid)).json())
      .toEqual({ code: 10004, message: 'file not found' })
    for (const key of ['appId', 'nonce', 'timestamp', 'signature'] as const) {
      expect(await (await grants.callback(prepared.config.fileId, 'permission', { ...valid, [key]: undefined })).json())
        .toEqual({ code: 10006, message: 'signature headers are incomplete' })
    }
    expect(await (await grants.callback(prepared.config.fileId, 'permission', { ...valid, timestamp: 'nope' })).json())
      .toEqual({ code: 10006, message: 'signature timestamp is expired' })
    expect(await (await grants.callback(prepared.config.fileId, 'permission', {
      ...valid, timestamp: String(now - 3_601),
    })).json()).toEqual({ code: 10006, message: 'signature timestamp is expired' })
    expect(await (await grants.callback(prepared.config.fileId, 'permission', { ...valid, appId: 'other' })).json())
      .toEqual({ code: 10006, message: 'application id does not match' })
    expect(await (await grants.callback(prepared.config.fileId, 'permission', { ...valid, signature: 'short' })).json())
      .toEqual({ code: 10006, message: 'signature verification failed' })
    secret = undefined
    expect(await (await grants.callback(prepared.config.fileId, 'permission', valid)).json())
      .toEqual({ code: 10006, message: 'signature verification failed' })
  })

  it('serves suffix and open ranges, empty files, and vanished grants safely', async () => {
    const path = await documentPath()
    const grants = new TencentDocsPreviewGrants({
      appId: 'app', publicUrl: 'https://harness.example', resolveAppSecret: () => Promise.resolve('secret'),
    })
    const prepared = await grants.prepare(path)
    const now = Math.floor(Date.now() / 1000)
    const headers = {
      appId: 'app', nonce: 'nonce', timestamp: String(now), signature: signature('app', 'secret', 'nonce', now),
      fileToken: prepared.config.fileToken,
    }
    const download = await grants.callback(prepared.config.fileId, 'download-info', headers)
    const body = await download.json() as { data: { url: string } }
    const [, fileId = '', token = ''] = /\/content\/([^/]+)\/([^/]+)$/.exec(body.data.url) ?? []
    expect(await (await grants.file(fileId, token, 'bytes=-3', new AbortController().signal)).text()).toBe('789')
    expect(await (await grants.file(fileId, token, 'bytes=7-', new AbortController().signal)).text()).toBe('789')
    const clamped = await grants.file(fileId, token, 'bytes=7-99', new AbortController().signal)
    expect(clamped.headers.get('content-range')).toBe('bytes 7-9/10')
    for (const range of ['bytes=-0', 'bytes=-', 'bytes=5-4', 'bytes=999999999999999999999-', 'items=0-1']) {
      expect((await grants.file(fileId, token, range, new AbortController().signal)).status).toBe(416)
    }
    expect((await grants.file('missing', token, undefined, new AbortController().signal)).status).toBe(404)
    expect((await grants.file(fileId, 'wrong', undefined, new AbortController().signal)).status).toBe(404)

    await unlink(path)
    expect(await (await grants.callback(fileId, 'file-info', headers)).json())
      .toEqual({ code: 10004, message: 'file not found' })
    expect((await grants.file(fileId, token, undefined, new AbortController().signal)).status).toBe(500)

    const emptyPath = await documentPath('empty.pdf')
    await writeFile(emptyPath, '')
    const emptyPrepared = await grants.prepare(emptyPath)
    const emptyDownload = await grants.callback(emptyPrepared.config.fileId, 'download-info', {
      ...headers, fileToken: emptyPrepared.config.fileToken,
    })
    const emptyBody = await emptyDownload.json() as { data: { url: string } }
    const [, emptyId = '', emptyToken = ''] = /\/content\/([^/]+)\/([^/]+)$/.exec(emptyBody.data.url) ?? []
    const empty = await grants.file(emptyId, emptyToken, undefined, new AbortController().signal)
    expect(empty.status).toBe(200)
    expect(empty.headers.get('content-length')).toBe('0')
    expect((await grants.file(emptyId, emptyToken, 'bytes=0-', new AbortController().signal)).status).toBe(416)
  })
})
