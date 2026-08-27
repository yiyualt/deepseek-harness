// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TencentDocsEditorConfig } from '@deepseek-ai/dsh-client-connection/client'
import {
  ArtifactPreviewPanel, type ArtifactPreviewPanelProps,
} from '../src/client/ArtifactPreviewPanel.tsx'
import { ArtifactPreviewController } from '../src/client/artifact-preview-controller.ts'
import type { ArtifactPreviewState } from '../src/client/artifact-preview-store.ts'
import { TencentDocsPreview, tencentDocsErrorMessage } from '../src/client/TencentDocsPreview.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as Window & { TencentDocsSDK?: unknown }).TencentDocsSDK
  for (const script of document.querySelectorAll('script[src*="tencent-test"]')) script.remove()
})

const SID = 'preview-session' as SessionId
const PREVIEW_URL = '/api/artifact-preview/00000000-0000-4000-8000-000000000000/report.html'

function successApi() {
  return {
    host: {
      prepareArtifactPreview: vi.fn(async ({ path }: { path: string }) => {
        const name = path.split('/').at(-1) ?? path
        if (path.endsWith('.docx')) {
          return {
            rpcId: 'preview',
            result: {
              ok: true as const,
              value: {
                kind: 'office' as const,
                name,
                apiUrl: 'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
                config: officeConfig(name),
              },
            },
          }
        }
        if (/\.(?:md|markdown)$/i.test(path)) {
          return {
            rpcId: 'preview',
            result: {
              ok: true as const,
              value: {
                kind: 'markdown' as const,
                name,
                grantId: '00000000-0000-4000-8000-000000000001',
                content: '# Draft\n',
                revision: 'a'.repeat(64),
              },
            },
          }
        }
        if (/\.(?:doc|txt|xls|xlsx|csv|ppt|pptx|pdf)$/i.test(path)) {
          return {
            rpcId: 'preview',
            result: {
              ok: true as const,
              value: {
                kind: 'tencent-docs' as const,
                name,
                scriptUrl: 'https://cdn.addon.tencentsuite.com/lib/web-sdk/global.js',
                config: tencentDocsConfig(path.split('.').at(-1) ?? 'pdf'),
              },
            },
          }
        }
        return {
          rpcId: 'preview',
          result: { ok: true as const, value: { kind: 'html' as const, name, url: `${PREVIEW_URL}/${name}` } },
        }
      }),
      saveMarkdownArtifact: vi.fn(async () => ({
        rpcId: 'save',
        result: { ok: true as const, value: { revision: 'b'.repeat(64) } },
      })),
    },
  }
}

function officeConfig(name = 'report.docx') {
  return {
    width: '100%' as const,
    height: '100%' as const,
    documentType: 'word' as const,
    document: {
      fileType: 'docx' as const,
      key: 'document-key',
      title: name,
      url: 'http://host.docker.internal:3080/api/office-preview/token/file',
      permissions: { edit: true as const, download: true as const },
    },
    editorConfig: {
      mode: 'edit' as const,
      callbackUrl: 'http://host.docker.internal:3080/api/office-preview/token/callback',
      customization: {},
      user: { id: 'deepseek-harness' as const, name: 'DeepSeek Harness' as const },
    },
  }
}

function tencentDocsConfig(officeType = 'pdf') {
  return {
    appId: 'app-123',
    signature: { sign: 'a'.repeat(40), nonce: 'nonce', timeStamp: 1_700_000_000 },
    officeType: officeType as 'pdf',
    fileId: '00000000-0000-4000-8000-000000000002',
    fileToken: '00000000-0000-4000-8000-000000000003',
    mode: 'simple' as const,
  }
}

describe('ArtifactPreviewController', () => {
  it('declines unsupported files and opens HTML in the artifact panel', async () => {
    const api = successApi()
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(api as never, layout)

    await expect(controller.open({ sessionId: SID, path: '/workspace/archive.zip' })).resolves.toBe(false)
    expect(api.host.prepareArtifactPreview).not.toHaveBeenCalled()

    await expect(controller.open({ sessionId: SID, path: '/workspace/report.html' })).resolves.toBe(true)
    expect(layout.openDetails).toHaveBeenCalledWith('artifact-preview', 'wide')
    expect(api.host.prepareArtifactPreview).toHaveBeenCalledWith({ path: '/workspace/report.html' })
    const snapshot = controller.sourceFor(SID).getSnapshot()
    expect(typeof snapshot.activeId).toBe('string')
    expect(typeof snapshot.tabs[0]?.id).toBe('string')
    expect(snapshot).toMatchObject({
      tabs: [{
        status: 'ready', name: 'report.html', path: '/workspace/report.html',
      }],
    })
  })

  it('edits and conflict-safely saves a Markdown tab', async () => {
    const api = successApi()
    const controller = new ArtifactPreviewController(api as never, {
      openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn(),
    })

    await expect(controller.open({ sessionId: SID, path: '/workspace/notes.md' })).resolves.toBe(true)
    const tab = controller.sourceFor(SID).getSnapshot().tabs[0]
    expect(tab).toMatchObject({
      status: 'ready', kind: 'markdown', name: 'notes.md',
      markdownContent: '# Draft\n', markdownSavedContent: '# Draft\n',
    })
    controller.editMarkdown(SID, tab?.id ?? '', '# Updated\n')
    await controller.saveMarkdown(SID, tab?.id ?? '')
    expect(api.host.saveMarkdownArtifact).toHaveBeenCalledWith({
      grantId: '00000000-0000-4000-8000-000000000001',
      content: '# Updated\n',
      revision: 'a'.repeat(64),
    })
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({
      markdownSavedContent: '# Updated\n', markdownRevision: 'b'.repeat(64), markdownSaving: false,
    })

    api.host.saveMarkdownArtifact.mockResolvedValueOnce({
      rpcId: 'save',
      result: {
        ok: false,
        error: {
          code: 'artifact-preview-conflict', message: 'changed on disk', details: { path: '/workspace/notes.md' },
        },
      },
    } as never)
    controller.editMarkdown(SID, tab?.id ?? '', '# Conflicting\n')
    await controller.saveMarkdown(SID, tab?.id ?? '')
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({
      markdownConflict: true, markdownError: 'changed on disk', markdownSaving: false,
    })
  })

  it('retains multiple tabs, reactivates an existing path, and closes the last panel', async () => {
    const api = successApi()
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(api as never, layout)

    await controller.open({ sessionId: SID, path: '/workspace/one.html' })
    await controller.open({ sessionId: SID, path: '/workspace/two.html' })
    const opened = controller.sourceFor(SID).getSnapshot()
    expect(typeof opened.activeId).toBe('string')
    expect(opened).toMatchObject({
      tabs: [{ path: '/workspace/one.html' }, { path: '/workspace/two.html' }],
    })

    const [one, two] = controller.sourceFor(SID).getSnapshot().tabs
    await controller.open({ sessionId: SID, path: '/workspace/one.html' })
    expect(api.host.prepareArtifactPreview).toHaveBeenCalledTimes(2)
    expect(controller.sourceFor(SID).getSnapshot().activeId).toBe(one?.id)

    controller.close(SID, one?.id ?? '')
    expect(controller.sourceFor(SID).getSnapshot().activeId).toBe(two?.id)
    controller.close(SID, two?.id ?? '')
    expect(controller.sourceFor(SID).getSnapshot()).toEqual({ tabs: [] })
    expect(layout.closeDetails).toHaveBeenCalledTimes(1)
  })

  it('opens DOCX as an editable Office tab', async () => {
    const api = successApi()
    const controller = new ArtifactPreviewController(api as never, {
      openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn(),
    })
    await expect(controller.open({ sessionId: SID, path: '/workspace/report.docx' })).resolves.toBe(true)
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({
      status: 'ready',
      kind: 'office',
      name: 'report.docx',
      officeApiUrl: 'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
      officeConfig: { documentType: 'word', editorConfig: { mode: 'edit' } },
    })
    const originalId = controller.sourceFor(SID).getSnapshot().tabs[0]?.id
    await controller.open({ sessionId: SID, path: '/workspace/report.docx' })
    expect(api.host.prepareArtifactPreview).toHaveBeenCalledTimes(2)
    expect(controller.sourceFor(SID).getSnapshot().tabs).toHaveLength(1)
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]?.id).toBe(originalId)
  })

  it('opens supported Office and PDF artifacts as Tencent Docs preview tabs', async () => {
    const api = successApi()
    const controller = new ArtifactPreviewController(api as never, {
      openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn(),
    })
    await expect(controller.open({ sessionId: SID, path: '/workspace/report.pdf' })).resolves.toBe(true)
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({
      status: 'ready',
      kind: 'tencent-docs',
      name: 'report.pdf',
      tencentDocsScriptUrl: 'https://cdn.addon.tencentsuite.com/lib/web-sdk/global.js',
      tencentDocsConfig: { appId: 'app-123', officeType: 'pdf', mode: 'simple' },
    })
    const originalId = controller.sourceFor(SID).getSnapshot().tabs[0]?.id
    await controller.open({ sessionId: SID, path: '/workspace/report.pdf' })
    expect(api.host.prepareArtifactPreview).toHaveBeenCalledTimes(2)
    expect(controller.sourceFor(SID).getSnapshot().tabs).toHaveLength(1)
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]?.id).toBe(originalId)
  })

  it('adds an active blank tab and reuses it for the next HTML path', async () => {
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(successApi() as never, layout)
    controller.newTab(SID)
    const snapshot = controller.sourceFor(SID).getSnapshot()
    expect(typeof snapshot.activeId).toBe('string')
    expect(typeof snapshot.tabs[0]?.id).toBe('string')
    expect(snapshot).toMatchObject({
      tabs: [{ status: 'idle', name: '', path: '' }],
    })
    expect(layout.openDetails).toHaveBeenCalledWith('artifact-preview', 'wide')

    await controller.open({ sessionId: SID, path: '/workspace/from-blank.html' })
    expect(controller.sourceFor(SID).getSnapshot()).toMatchObject({
      activeId: snapshot.activeId,
      tabs: [{ status: 'ready', name: 'from-blank.html', path: '/workspace/from-blank.html' }],
    })
  })

  it('restores a reused blank tab when the Host declines an optional document provider', async () => {
    const api = successApi()
    api.host.prepareArtifactPreview.mockResolvedValueOnce({
      rpcId: 'preview',
      result: {
        ok: false,
        error: { code: 'artifact-preview-unsupported', message: 'provider disabled', details: {} },
      },
    } as never)
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(api as never, layout)
    controller.newTab(SID)
    const blankId = controller.sourceFor(SID).getSnapshot().activeId

    await expect(controller.open({ sessionId: SID, path: '/workspace/report.pdf' })).resolves.toBe(false)
    expect(controller.sourceFor(SID).getSnapshot()).toMatchObject({
      activeId: blankId,
      tabs: [{ id: blankId, status: 'idle', requestId: 0, path: '', name: '' }],
    })
    expect(layout.closeDetails).not.toHaveBeenCalled()
  })

  it('navigates an empty tab to an HTTP page and rejects other schemes', () => {
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(successApi() as never, layout)
    controller.newTab(SID)
    const first = controller.sourceFor(SID).getSnapshot().activeId ?? ''

    expect(controller.openUrl(SID, first, 'example.com/docs')).toBe(true)
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({
      status: 'ready',
      kind: 'html',
      name: 'example.com',
      path: 'https://example.com/docs',
      url: 'https://example.com/docs',
    })

    controller.newTab(SID)
    const second = controller.sourceFor(SID).getSnapshot().activeId ?? ''
    expect(controller.openUrl(SID, second, 'file:///tmp/report.html')).toBe(false)
    expect(controller.openUrl(SID, 'missing', 'https://example.com')).toBe(false)
    expect(controller.sourceFor(SID).getSnapshot().tabs[1]).toMatchObject({ status: 'idle' })
  })

  it('retains a readable error when preparation fails', async () => {
    const api = successApi()
    api.host.prepareArtifactPreview.mockResolvedValueOnce({
      rpcId: 'preview',
      result: {
        ok: false,
        error: { code: 'artifact-preview-unavailable', message: 'missing', details: { path: '/x.html' } },
      },
    } as never)
    const controller = new ArtifactPreviewController(api as never, {
      openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn(),
    })

    await controller.open({ sessionId: SID, path: '/x.html' })
    expect(controller.sourceFor(SID).getSnapshot().tabs[0]).toMatchObject({ status: 'error', error: 'missing' })

    api.host.prepareArtifactPreview.mockRejectedValueOnce(new Error('offline'))
    await controller.open({ sessionId: SID, path: '/y.xhtml' })
    expect(controller.sourceFor(SID).getSnapshot().tabs[1]).toMatchObject({ status: 'error', error: 'offline' })
  })
})

function panelProps(
  state: ArtifactPreviewState,
  actions: {
    activatePreview?: (id: string) => void
    newPreviewTab?: () => void
    openPreviewUrl?: (id: string, url: string) => boolean
    closePreviewTab?: (id: string) => void
    closePreview?: () => void
    editMarkdown?: (id: string, content: string) => void
    saveMarkdown?: (id: string) => void
  } = {},
): ArtifactPreviewPanelProps {
  return {
    panel: 'artifact-preview',
    matched: { panel: 'artifact-preview' },
    sessionId: SID,
    usePreview: (select: (value: ArtifactPreviewState) => unknown) => select(state),
    useSession: vi.fn(),
    useSessions: vi.fn(),
    useWorkspaces: vi.fn(),
    SessionProvider: vi.fn(),
    activatePreview: actions.activatePreview ?? vi.fn(),
    newPreviewTab: actions.newPreviewTab ?? vi.fn(),
    openPreviewUrl: actions.openPreviewUrl ?? vi.fn(() => true),
    closePreviewTab: actions.closePreviewTab ?? vi.fn(),
    closePreview: actions.closePreview ?? vi.fn(),
    editMarkdown: actions.editMarkdown ?? vi.fn(),
    saveMarkdown: actions.saveMarkdown ?? vi.fn(),
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'preview.frameTitle') return `${params?.name ?? ''} preview`
      if (key === 'preview.closeTab') return `Close ${params?.name ?? ''}`
      return key
    },
  } as unknown as ArtifactPreviewPanelProps
}

describe('ArtifactPreviewPanel', () => {
  it('renders active lifecycle states', () => {
    const closePreview = vi.fn()
    const view = render(<ArtifactPreviewPanel {...panelProps({
      activeId: 'report',
      tabs: [{ id: 'report', status: 'loading', requestId: 1, name: 'report.html', path: '/report.html' }],
    }, { closePreview })} />)
    expect(view.getByRole('status').textContent).toBe('preview.loading')

    view.rerender(<ArtifactPreviewPanel {...panelProps({
      activeId: 'report',
      tabs: [{
        id: 'report', status: 'error', requestId: 1,
        name: 'report.html', path: '/report.html', error: 'broken',
      }],
    }, { closePreview })} />)
    expect(view.getByRole('alert').textContent).toBe('broken')
  })

  it('keeps ready frames mounted and exposes tab activation and close actions', () => {
    const activatePreview = vi.fn()
    const newPreviewTab = vi.fn()
    const closePreviewTab = vi.fn()
    const closePreview = vi.fn()
    const view = render(<ArtifactPreviewPanel {...panelProps({
      activeId: 'two',
      tabs: [
        { id: 'one', status: 'ready', requestId: 1, name: 'one.html', path: '/one.html', url: '/one' },
        { id: 'two', status: 'ready', requestId: 2, name: 'two.html', path: '/two.html', url: '/two' },
      ],
    }, { activatePreview, newPreviewTab, closePreviewTab, closePreview })} />)
    const oneFrame = view.getByTitle('one.html preview')
    const twoFrame = view.getByTitle('two.html preview')
    expect(oneFrame.parentElement?.hasAttribute('hidden')).toBe(true)
    expect(twoFrame.parentElement?.hasAttribute('hidden')).toBe(false)
    expect(twoFrame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')

    fireEvent.click(view.getByRole('tab', { name: 'one.html' }))
    expect(activatePreview).toHaveBeenCalledWith('one')
    fireEvent.click(view.getByRole('button', { name: 'preview.addTab' }))
    expect(newPreviewTab).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('button', { name: 'Close two.html' }))
    expect(closePreviewTab).toHaveBeenCalledWith('two')
    fireEvent.click(view.getByRole('button', { name: 'preview.close' }))
    expect(closePreview).toHaveBeenCalledTimes(1)
  })

  it('submits a website address from an empty tab and shows invalid input', () => {
    const openPreviewUrl = vi.fn((_id: string, url: string) => url === 'example.com')
    const view = render(<ArtifactPreviewPanel {...panelProps({
      activeId: 'blank',
      tabs: [{ id: 'blank', status: 'idle', requestId: 0, name: '', path: '' }],
    }, { openPreviewUrl })} />)

    const input = view.getByLabelText('preview.urlLabel')
    fireEvent.change(input, { target: { value: 'file:///tmp/report.html' } })
    fireEvent.click(view.getByRole('button', { name: 'preview.openUrl' }))
    expect(openPreviewUrl).toHaveBeenLastCalledWith('blank', 'file:///tmp/report.html')
    expect(view.getByRole('alert').textContent).toBe('preview.invalidUrl')

    fireEvent.change(input, { target: { value: 'example.com' } })
    expect(view.queryByRole('alert')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'preview.openUrl' }))
    expect(openPreviewUrl).toHaveBeenLastCalledWith('blank', 'example.com')
  })

  it('mounts the ONLYOFFICE editor for a ready DOCX tab', async () => {
    const destroyEditor = vi.fn()
    const DocEditor = vi.fn(function () { return { destroyEditor } })
    Object.defineProperty(window, 'DocsAPI', {
      configurable: true,
      value: { DocEditor },
    })
    const view = render(<ArtifactPreviewPanel {...panelProps({
      activeId: 'doc',
      tabs: [{
        id: 'doc', status: 'ready', requestId: 1, kind: 'office',
        name: 'report.docx', path: '/report.docx',
        officeApiUrl: 'http://127.0.0.1:8080/web-apps/apps/api/documents/api.js',
        officeConfig: officeConfig(),
      }],
    })} />)
    await waitFor(() => { expect(DocEditor).toHaveBeenCalledTimes(1) })
    expect(view.container.querySelector('[data-onlyoffice-editor]')).not.toBeNull()
    view.unmount()
    expect(destroyEditor).toHaveBeenCalledTimes(1)
    delete (window as Window & { DocsAPI?: unknown }).DocsAPI
  })

  it('mounts and destroys the Tencent Docs WebSDK preview with its tab', async () => {
    const destroy = vi.fn()
    const ready = vi.fn(async () => {})
    const init = vi.fn((_config: TencentDocsEditorConfig & { mount: HTMLElement }) => ({ ready, destroy }))
    Object.defineProperty(window, 'TencentDocsSDK', {
      configurable: true,
      value: { init },
    })
    const view = render(<ArtifactPreviewPanel {...panelProps({
      activeId: 'pdf',
      tabs: [{
        id: 'pdf', status: 'ready', requestId: 1, kind: 'tencent-docs',
        name: 'report.pdf', path: '/report.pdf',
        tencentDocsScriptUrl: 'https://cdn.addon.tencentsuite.com/lib/web-sdk/global.js',
        tencentDocsConfig: tencentDocsConfig(),
      }],
    })} />)
    await waitFor(() => { expect(ready).toHaveBeenCalledTimes(1) })
    const initialized = init.mock.calls[0]?.[0]
    expect(initialized).toMatchObject({ appId: 'app-123', officeType: 'pdf', mode: 'simple' })
    expect(initialized?.mount).toBeInstanceOf(HTMLElement)
    expect(view.container.querySelector('[data-tencent-docs-preview]')).not.toBeNull()
    view.unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('loads one Tencent script for concurrent previews and initializes both mounts', async () => {
    const ready = vi.fn(async () => {})
    const destroy = vi.fn()
    const init = vi.fn((_config: TencentDocsEditorConfig & { mount: HTMLElement }) => ({ ready, destroy }))
    const scriptUrl = 'https://sdk.example/tencent-test-shared.js'
    const view = render(<>
      <TencentDocsPreview scriptUrl={scriptUrl} config={tencentDocsConfig()} />
      <TencentDocsPreview scriptUrl={scriptUrl} config={tencentDocsConfig('xlsx')} />
    </>)
    const scripts = document.querySelectorAll(`script[src="${scriptUrl}"]`)
    expect(scripts).toHaveLength(1)
    Object.defineProperty(window, 'TencentDocsSDK', { configurable: true, value: { init } })
    fireEvent.load(scripts[0] as HTMLScriptElement)
    await waitFor(() => { expect(init).toHaveBeenCalledTimes(2) })
    expect(ready).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(destroy).toHaveBeenCalledTimes(2)
  })

  it('shows script errors and retries a failed Tencent SDK URL', async () => {
    const scriptUrl = 'https://sdk.example/tencent-test-retry.js'
    const first = render(<TencentDocsPreview scriptUrl={scriptUrl} config={tencentDocsConfig()} />)
    const failedScript = document.querySelector(`script[src="${scriptUrl}"]`) as HTMLScriptElement
    fireEvent.error(failedScript)
    await waitFor(() => {
      expect(first.getByRole('alert').textContent).toContain('Unable to load Tencent Docs WebSDK')
    })
    first.unmount()

    const ready = vi.fn(async () => {})
    const init = vi.fn(() => ({ ready, destroy: vi.fn() }))
    const retry = render(<TencentDocsPreview scriptUrl={scriptUrl} config={tencentDocsConfig()} />)
    const scripts = document.querySelectorAll(`script[src="${scriptUrl}"]`)
    expect(scripts).toHaveLength(2)
    Object.defineProperty(window, 'TencentDocsSDK', { configurable: true, value: { init } })
    fireEvent.load(scripts[1] as HTMLScriptElement)
    await waitFor(() => { expect(ready).toHaveBeenCalledTimes(1) })
    retry.unmount()
  })

  it('reports malformed SDK globals and readiness failures', async () => {
    const missingUrl = 'https://sdk.example/tencent-test-missing.js'
    const missing = render(<TencentDocsPreview scriptUrl={missingUrl} config={tencentDocsConfig()} />)
    fireEvent.load(document.querySelector(`script[src="${missingUrl}"]`) as HTMLScriptElement)
    await waitFor(() => {
      expect(missing.getByRole('alert').textContent).toBe('Tencent Docs WebSDK loaded without TencentDocsSDK')
    })
    missing.unmount()

    Object.defineProperty(window, 'TencentDocsSDK', {
      configurable: true,
      value: { init: () => ({ ready: () => Promise.reject(new Error('readiness failed')), destroy: vi.fn() }) },
    })
    const rejected = render(<TencentDocsPreview
      scriptUrl="https://sdk.example/tencent-test-rejected.js"
      config={tencentDocsConfig()}
    />)
    await waitFor(() => { expect(rejected.getByRole('alert').textContent).toBe('readiness failed') })
    expect(tencentDocsErrorMessage('plain failure')).toBe('plain failure')
  })

  it('does not initialize a Tencent SDK after its preview unmounts during script loading', async () => {
    const scriptUrl = 'https://sdk.example/tencent-test-disposed.js'
    const init = vi.fn()
    const view = render(<TencentDocsPreview scriptUrl={scriptUrl} config={tencentDocsConfig()} />)
    const script = document.querySelector(`script[src="${scriptUrl}"]`) as HTMLScriptElement
    view.unmount()
    Object.defineProperty(window, 'TencentDocsSDK', { configurable: true, value: { init } })
    fireEvent.load(script)
    await Promise.resolve()
    expect(init).not.toHaveBeenCalled()
  })

  it('ignores a Tencent readiness failure after its preview has unmounted', async () => {
    let rejectReady: ((reason: unknown) => void) | undefined
    const ready = () => new Promise<void>((_resolve, reject) => { rejectReady = reject })
    const destroy = vi.fn()
    Object.defineProperty(window, 'TencentDocsSDK', {
      configurable: true,
      value: { init: () => ({ ready, destroy }) },
    })
    const view = render(<TencentDocsPreview
      scriptUrl="https://sdk.example/tencent-test-late-rejection.js"
      config={tencentDocsConfig()}
    />)
    await waitFor(() => { expect(rejectReady).toBeTypeOf('function') })
    view.unmount()
    rejectReady?.(new Error('late failure'))
    await Promise.resolve()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('renders, edits, and saves a ready Markdown tab', () => {
    const editMarkdown = vi.fn()
    const saveMarkdown = vi.fn()
    const state: ArtifactPreviewState = {
      activeId: 'markdown',
      tabs: [{
        id: 'markdown', status: 'ready', requestId: 1, kind: 'markdown',
        name: 'notes.md', path: '/notes.md',
        markdownGrantId: 'grant', markdownContent: '# Title\n',
        markdownSavedContent: '# Title\n', markdownRevision: 'a'.repeat(64),
        markdownSaving: false,
      }],
    }
    const view = render(<ArtifactPreviewPanel {...panelProps(state, { editMarkdown, saveMarkdown })} />)
    expect(view.getByRole('heading', { name: 'Title' })).toBeDefined()
    expect(view.getByRole('button', { name: 'preview.markdownSave' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(view.getByLabelText('preview.markdownSource'), { target: { value: '# Updated\n' } })
    expect(editMarkdown).toHaveBeenCalledWith('markdown', '# Updated\n')
    state.tabs[0]!.markdownContent = '# Updated\n'
    view.rerender(<ArtifactPreviewPanel {...panelProps(state, { editMarkdown, saveMarkdown })} />)
    fireEvent.click(view.getByRole('button', { name: 'preview.markdownSave' }))
    expect(saveMarkdown).toHaveBeenCalledWith('markdown')

    state.tabs[0]!.markdownConflict = true
    view.rerender(<ArtifactPreviewPanel {...panelProps(state, { editMarkdown, saveMarkdown })} />)
    expect(view.getByRole('alert').textContent).toBe('preview.markdownConflict')
  })
})
