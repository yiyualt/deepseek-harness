/**
 * downloads domain zod schemas. The download surface has no wire
 * envelope: the request arrives as query parameters (all strings), so its
 * request schema parses the raw query-parameter object into the method's
 * exact request shape. SessionId brand cast point: sessionIdSchema, and only
 * there (hosted in sessions.schema like every other cast).
 */

import { z } from 'zod'
import type { DownloadsApi } from './downloads.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** Artifact-preview path fields parsed from the physical GET route. */
export const artifactPreviewPathSchema = z.object({
  token: z.uuid(),
  path: z.string().min(1),
}) satisfies z.ZodType<Parameters<DownloadsApi['artifactPreview']>[0]>

/** Opaque Office-preview token parsed from its physical route. */
export const officePreviewTokenSchema = z.object({
  token: z.uuid(),
}) satisfies z.ZodType<Parameters<DownloadsApi['officePreviewFile']>[0]>

/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
export const sessionLogQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    includeDescendants: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
  .transform(query => ({
    sessionId: query.sessionId,
    ...(query.includeDescendants === 'true' ? { includeDescendants: true } : {}),
  })) satisfies z.ZodType<Parameters<DownloadsApi['sessionLog']>[0]>
