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

/** File types accepted by the Tencent Docs browser preview service. */
export type TencentDocsOfficeType =
  | 'doc' | 'docx' | 'txt'
  | 'xls' | 'xlsx' | 'csv'
  | 'ppt' | 'pptx' | 'pdf'

/** Browser-safe configuration passed to `TencentDocsSDK.init()`. */
export interface TencentDocsEditorConfig {
  appId: string
  signature: { sign: string; nonce: string; timeStamp: number }
  officeType: TencentDocsOfficeType
  fileId: string
  fileToken: string
  mode: 'simple'
}

/** Editable run fields exchanged with the browser DOCX editor. */
export interface GenOfficeDocxRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  sizeHalfPoints?: number
  font?: string
  shading?: string
}

/** One browser-safe DOCX block projected by the local GenOffice engine. */
export interface GenOfficeDocxBlock {
  docxIndex: number
  type: 'paragraph' | 'heading' | 'listItem' | 'table' | 'image' | 'passthrough'
  text: string
  editable: boolean
  runs?: GenOfficeDocxRun[]
  align?: 'left' | 'center' | 'right' | 'both'
  level?: number
  label?: string
}

/** One editable paragraph value sent back to the local GenOffice engine. */
export interface GenOfficeDocxEdit {
  docxIndex: number
  runs: GenOfficeDocxRun[]
  align?: 'left' | 'center' | 'right' | 'both'
}

/** Uniform text formatting editable for one projected PowerPoint text box. */
export interface GenOfficePptxTextStyle {
  fontFamily?: string
  fontSize?: number
  bold: boolean
  italic: boolean
  underline: boolean
  color?: string
  align: 'left' | 'center' | 'right' | 'justify'
}

/** Geometry shared by projected PowerPoint slide elements, in EMU. */
export interface GenOfficePptxElementFrame {
  elementIndex: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** One browser-safe PowerPoint element projected by the local GenOffice engine. */
export type GenOfficePptxElement = GenOfficePptxElementFrame & (
  | {
    kind: 'text'
    text: string
    editable: boolean
    style: GenOfficePptxTextStyle
    fill?: string
    stroke?: string
  }
  | { kind: 'picture'; dataUrl?: string; opacity: number }
  | { kind: 'shape'; fill?: string; stroke?: string }
  | { kind: 'protected'; label: string }
)

/** One browser-safe PowerPoint slide. */
export interface GenOfficePptxSlide {
  slideIndex: number
  width: number
  height: number
  background?: string
  elements: GenOfficePptxElement[]
}

/** Complete replacement value for one editable PowerPoint text box. */
export interface GenOfficePptxEdit {
  slideIndex: number
  elementIndex: number
  text: string
  style: GenOfficePptxTextStyle
}

/** Cell value accepted by the local GenOffice XLSX editor. */
export type GenOfficeXlsxCellValue = string | number | boolean | null

/** One browser-safe populated XLSX cell. */
export interface GenOfficeXlsxCell {
  address: string
  value: GenOfficeXlsxCellValue
  formula?: string
}

/** One browser-safe XLSX worksheet. */
export interface GenOfficeXlsxSheet {
  id: string
  name: string
  cells: GenOfficeXlsxCell[]
}

/** One writable XLSX border edge. */
export interface GenOfficeXlsxBorder {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair' | 'dashDot' | 'dashDotDot' | 'mediumDashed' | 'mediumDashDot' | 'mediumDashDotDot' | 'slantDashDot'
  color?: string
}

/** Supported XLSX cell-format delta emitted by the browser grid. */
export interface GenOfficeXlsxStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  underlineStyle?: 'single' | 'double'
  strikethrough?: boolean
  fontFamily?: string
  fontSize?: number
  fontColor?: string | null
  fillColor?: string | null
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify' | 'distributed'
  verticalAlignment?: 'top' | 'center' | 'bottom'
  wrapText?: boolean
  textRotation?: number
  indent?: number
  numberFormat?: string
  borderTop?: GenOfficeXlsxBorder | null
  borderBottom?: GenOfficeXlsxBorder | null
  borderLeft?: GenOfficeXlsxBorder | null
  borderRight?: GenOfficeXlsxBorder | null
}

/** One cell delta sent back to the local GenOffice XLSX engine. */
export interface GenOfficeXlsxEdit {
  sheetName: string
  row: number
  column: number
  writeValue: boolean
  value: GenOfficeXlsxCellValue
  formula?: string
  style?: GenOfficeXlsxStyle
  styleReset?: boolean
}

/** Prepared renderer selected from the artifact's file type. */
export type ArtifactPreviewValue =
  | { kind: 'html'; name: string; url: string; grantId: string; content: string; revision: string }
  | { kind: 'markdown'; name: string; grantId: string; content: string; revision: string }
  | { kind: 'genoffice-docx'; name: string; grantId: string; blocks: GenOfficeDocxBlock[]; revision: string }
  | { kind: 'genoffice-pptx'; name: string; grantId: string; slides: GenOfficePptxSlide[]; revision: string }
  | { kind: 'genoffice-xlsx'; name: string; grantId: string; sheets: GenOfficeXlsxSheet[]; revision: string }
  | { kind: 'office'; name: string; apiUrl: string; config: OfficeEditorConfig }
  | { kind: 'tencent-docs'; name: string; scriptUrl: string; config: TencentDocsEditorConfig }

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
   * Prepare one existing HTML, Markdown, or supported document file for the
   * Web preview column. HTML returns a same-origin resource URL, UTF-8 source,
   * and an edit grant; Markdown returns UTF-8 source and an edit grant; local GenOffice returns DOCX, XLSX, or
   * PPTX projections, and configured external providers return browser editor data.
   */
  prepareArtifactPreview(
    request: RpcRequest<{ path: string }>,
  ): Promise<RpcResponse<ArtifactPreviewValue>>

  /**
   * Save complete HTML source through a preparation grant. The save fails
   * with `artifact-preview-conflict` when the file changed since the revision
   * supplied by the caller.
   */
  saveHtmlArtifact(
    request: RpcRequest<{ grantId: string; content: string; revision: string }>,
  ): Promise<RpcResponse<{ revision: string }>>

  /**
   * Save complete Markdown source through a preparation grant. The save
   * fails with `artifact-preview-conflict` when the file changed since the
   * revision supplied by the caller.
   */
  saveMarkdownArtifact(
    request: RpcRequest<{ grantId: string; content: string; revision: string }>,
  ): Promise<RpcResponse<{ revision: string }>>

  /**
   * Save editable DOCX paragraph values through a local GenOffice grant. The
   * save fails with `artifact-preview-conflict` when the file changed since
   * the supplied revision.
   */
  saveGenOfficeDocxArtifact(
    request: RpcRequest<{ grantId: string; edits: GenOfficeDocxEdit[]; revision: string }>,
  ): Promise<RpcResponse<{ revision: string; blocks: GenOfficeDocxBlock[] }>>

  /**
   * Save PPTX text-box replacements through a local GenOffice grant. The save
   * fails with `artifact-preview-conflict` when the file changed since the
   * supplied revision.
   */
  saveGenOfficePptxArtifact(
    request: RpcRequest<{ grantId: string; edits: GenOfficePptxEdit[]; revision: string }>,
  ): Promise<RpcResponse<{ revision: string; slides: GenOfficePptxSlide[] }>>

  /**
   * Save XLSX cell deltas through a local GenOffice grant. The save fails
   * with `artifact-preview-conflict` when the file changed since the supplied
   * revision.
   */
  saveGenOfficeXlsxArtifact(
    request: RpcRequest<{ grantId: string; edits: GenOfficeXlsxEdit[]; revision: string }>,
  ): Promise<RpcResponse<{ revision: string }>>
}
