/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Browser-safe ONLYOFFICE editor configuration produced by the Host. */
export interface OfficeEditorConfig {
  width: '100%'
  height: '100%'
  documentType: 'word'
  document: {
    fileType: 'docx'
    key: string
    title: string
    url: string
    permissions: { edit: true; download: true }
  }
  editorConfig: {
    mode: 'edit'
    callbackUrl: string
    customization: Record<string, never>
    user: { id: 'deepseek-harness'; name: 'DeepSeek Harness' }
  }
}

/** Prepared renderer selected from the artifact's file type. */
export type ArtifactPreviewValue =
  | { kind: 'html'; name: string; url: string }
  | { kind: 'markdown'; name: string; grantId: string; content: string; revision: string }
  | { kind: 'office'; name: string; apiUrl: string; config: OfficeEditorConfig }

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>

  /**
   * Prepare one existing HTML, Markdown, or DOCX file for the Web preview
   * column. HTML returns a same-origin iframe URL; Markdown returns UTF-8
   * source and an edit grant; DOCX returns a Host-issued ONLYOFFICE editor
   * configuration when that integration is configured.
   */
  prepareArtifactPreview(
    request: RpcRequest<{ path: string }>,
  ): Promise<RpcResponse<ArtifactPreviewValue>>

  /**
   * Save complete Markdown source through a preparation grant. The save
   * fails with `artifact-preview-conflict` when the file changed since the
   * revision supplied by the caller.
   */
  saveMarkdownArtifact(
    request: RpcRequest<{ grantId: string; content: string; revision: string }>,
  ): Promise<RpcResponse<{ revision: string }>>
}
