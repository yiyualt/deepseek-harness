/**
 * host domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { DirectoryEntry } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.describe'>>>

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  canOpenPath: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.describe'>>>

/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.pickDirectory'>>>

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.pickDirectory'>>>

/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<DirectoryEntry>>

/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listDirectory'>>>

/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listDirectory'>>>

/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
) satisfies z.ZodType<Wire<RequestPayload<'host.createDirectory'>>>

/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.createDirectory'>>>
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.openPath'>>>

/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.openPath'>>>

/** host.prepareArtifactPreview request payload. */
export const hostPrepareArtifactPreviewRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.prepareArtifactPreview'>>>

/** host.saveMarkdownArtifact request payload. */
export const hostSaveMarkdownArtifactRequestSchema = z.object({
  grantId: z.uuid(),
  content: z.string(),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveMarkdownArtifact'>>>

/** host.prepareArtifactPreview response value. */
export const hostPrepareArtifactPreviewValueSchema = z.union([
  z.object({
    kind: z.literal('html'),
    name: z.string().min(1),
    url: z.string().startsWith('/api/artifact-preview/'),
  }),
  z.object({
    kind: z.literal('markdown'),
    name: z.string().min(1),
    grantId: z.uuid(),
    content: z.string(),
    revision: z.string().length(64),
  }),
  z.object({
    kind: z.literal('office'),
    name: z.string().min(1),
    apiUrl: z.url(),
    config: z.object({
      width: z.literal('100%'),
      height: z.literal('100%'),
      documentType: z.literal('word'),
      document: z.object({
        fileType: z.literal('docx'),
        key: z.string().min(1),
        title: z.string().min(1),
        url: z.url(),
        permissions: z.object({ edit: z.literal(true), download: z.literal(true) }),
      }),
      editorConfig: z.object({
        mode: z.literal('edit'),
        callbackUrl: z.url(),
        customization: z.object({}),
        user: z.object({
          id: z.literal('deepseek-harness'),
          name: z.literal('DeepSeek Harness'),
        }),
      }),
    }),
  }),
  z.object({
    kind: z.literal('tencent-docs'),
    name: z.string().min(1),
    scriptUrl: z.url(),
    config: z.object({
      appId: z.string().min(1),
      signature: z.object({
        sign: z.string().length(40),
        nonce: z.string().min(1).max(64),
        timeStamp: z.number().int().nonnegative(),
      }),
      officeType: z.enum(['doc', 'docx', 'txt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'pdf']),
      fileId: z.uuid(),
      fileToken: z.uuid(),
      mode: z.literal('simple'),
    }),
  }),
]) satisfies z.ZodType<Wire<ResponseValue<'host.prepareArtifactPreview'>>>

/** host.saveMarkdownArtifact response value. */
export const hostSaveMarkdownArtifactValueSchema = z.object({
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveMarkdownArtifact'>>>
