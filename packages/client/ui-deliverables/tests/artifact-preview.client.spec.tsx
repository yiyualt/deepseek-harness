// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ArtifactPreviewPanel, type ArtifactPreviewPanelProps,
} from '../src/client/ArtifactPreviewPanel.tsx'
import { ArtifactPreviewController } from '../src/client/artifact-preview-controller.ts'
import type { ArtifactPreviewState } from '../src/client/artifact-preview-store.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
        return {
          rpcId: 'preview',
          result: { ok: true as const, value: { kind: 'html' as const, name, url: `${PREVIEW_URL}/${name}` } },
        }
      }),
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
      user: { id: 'deepseek-harness' as const, name: 'DeepSeek Harness' as const },
    },
  }
}

describe('ArtifactPreviewController', () => {
  it('declines unsupported files and opens HTML in the artifact panel', async () => {
    const api = successApi()
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
    const controller = new ArtifactPreviewController(api as never, layout)

    await expect(controller.open({ sessionId: SID, path: '/workspace/readme.md' })).resolves.toBe(false)
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
    closePreviewTab?: (id: string) => void
    closePreview?: () => void
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
    closePreviewTab: actions.closePreviewTab ?? vi.fn(),
    closePreview: actions.closePreview ?? vi.fn(),
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
})
