/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /** Serve one granted DOCX to ONLYOFFICE Document Server. */
  officePreviewFile(request: { token: string }, signal: AbortSignal): Promise<Response>

  /** Apply one ONLYOFFICE save callback to its granted workspace file. */
  officePreviewCallback(
    request: { token: string; body: unknown },
    signal: AbortSignal,
  ): Promise<Response>

  /**
   * Read one resource through an opaque artifact-preview grant. The carrier
   * serves this response inline inside a sandboxed iframe.
   * @param request - grant token and relative resource path from the URL.
   * @param signal - cancellation for the file read.
   * @returns isolated resource response; invalid or expired grants answer 404.
   */
  artifactPreview(
    request: { token: string; path: string },
    signal: AbortSignal,
  ): Promise<Response>

  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>
}
