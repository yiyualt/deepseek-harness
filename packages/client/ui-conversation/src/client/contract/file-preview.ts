/** Optional file-preview interception used before the Host native opener. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** One resolved chat-file open request. */
export interface ChatFilePreviewRequest {
  /** Session whose right-column state receives the preview. */
  sessionId: SessionId
  /** Absolute Host path resolved against the session cwd. */
  path: string
}

/**
 * Optional preview provider. A false result declines the file type and leaves
 * the existing native Host opener responsible for it.
 */
export interface ChatFilePreview {
  /**
   * Attempt an in-app preview.
   * @param request - resolved session and Host path.
   * @returns true when the provider claimed the file; false requests native fallback.
   */
  open(request: ChatFilePreviewRequest): Promise<boolean>
}
