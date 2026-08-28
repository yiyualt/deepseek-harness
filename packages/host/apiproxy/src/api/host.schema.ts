/**
 * host domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { DirectoryEntry } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

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

/** host.saveHtmlArtifact request payload. */
export const hostSaveHtmlArtifactRequestSchema = z.object({
  sessionId: sessionIdSchema,
  grantId: z.uuid(),
  content: z.string(),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveHtmlArtifact'>>>

/** host.saveMarkdownArtifact request payload. */
export const hostSaveMarkdownArtifactRequestSchema = z.object({
  sessionId: sessionIdSchema,
  grantId: z.uuid(),
  content: z.string(),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveMarkdownArtifact'>>>

const genOfficeDocxRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: z.string().regex(/^[0-9A-F]{6}$/).optional(),
  sizeHalfPoints: z.number().int().min(2).max(326).optional(),
  font: z.string().min(1).max(128).optional(),
  shading: z.string().regex(/^[0-9A-F]{6}$/).optional(),
})

const genOfficeDocxBlockSchema = z.object({
  docxIndex: z.number().int().nonnegative(),
  type: z.enum(['paragraph', 'heading', 'listItem', 'table', 'image', 'passthrough']),
  text: z.string(),
  editable: z.boolean(),
  runs: z.array(genOfficeDocxRunSchema).optional(),
  align: z.enum(['left', 'center', 'right', 'both']).optional(),
  level: z.number().int().min(1).max(9).optional(),
  label: z.string().optional(),
})

/** host.saveGenOfficeDocxArtifact request payload. */
export const hostSaveGenOfficeDocxArtifactRequestSchema = z.object({
  sessionId: sessionIdSchema,
  grantId: z.uuid(),
  edits: z.array(z.object({
    docxIndex: z.number().int().nonnegative(),
    runs: z.array(genOfficeDocxRunSchema),
    align: z.enum(['left', 'center', 'right', 'both']).optional(),
  })),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveGenOfficeDocxArtifact'>>>

const genOfficePptxTextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(128).optional(),
  fontSize: z.number().positive().max(400).optional(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/).optional(),
  align: z.enum(['left', 'center', 'right', 'justify']),
})

const genOfficePptxFrameSchema = z.object({
  elementIndex: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number(),
})

const genOfficePptxElementSchema = z.intersection(genOfficePptxFrameSchema, z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    editable: z.boolean(),
    style: genOfficePptxTextStyleSchema,
    fill: z.string().optional(),
    stroke: z.string().optional(),
  }),
  z.object({ kind: z.literal('picture'), dataUrl: z.string().optional(), opacity: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('shape'), fill: z.string().optional(), stroke: z.string().optional() }),
  z.object({ kind: z.literal('protected'), label: z.string() }),
]))

const genOfficePptxSlideSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string().optional(),
  elements: z.array(genOfficePptxElementSchema),
})

/** host.saveGenOfficePptxArtifact request payload. */
export const hostSaveGenOfficePptxArtifactRequestSchema = z.object({
  sessionId: sessionIdSchema,
  grantId: z.uuid(),
  edits: z.array(z.object({
    slideIndex: z.number().int().nonnegative(),
    elementIndex: z.number().int().nonnegative(),
    text: z.string(),
    style: genOfficePptxTextStyleSchema,
  })),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveGenOfficePptxArtifact'>>>

const genOfficeXlsxCellValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.null(),
])
const genOfficeXlsxBorderSchema = z.object({
  style: z.enum([
    'thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair', 'dashDot',
    'dashDotDot', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot', 'slantDashDot',
  ]),
  color: z.string().regex(/^#[0-9A-F]{6}$/).optional(),
})
const genOfficeXlsxStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  underlineStyle: z.enum(['single', 'double']).optional(),
  strikethrough: z.boolean().optional(),
  fontFamily: z.string().min(1).max(128).optional(),
  fontSize: z.number().positive().max(409).optional(),
  fontColor: z.union([z.string().regex(/^#[0-9A-F]{6}$/), z.null()]).optional(),
  fillColor: z.union([z.string().regex(/^#[0-9A-F]{6}$/), z.null()]).optional(),
  horizontalAlignment: z.enum(['left', 'center', 'right', 'justify', 'distributed']).optional(),
  verticalAlignment: z.enum(['top', 'center', 'bottom']).optional(),
  wrapText: z.boolean().optional(),
  textRotation: z.union([z.number().int().min(0).max(180), z.literal(255)]).optional(),
  indent: z.number().int().min(0).max(250).optional(),
  numberFormat: z.string().min(1).max(255).optional(),
  borderTop: z.union([genOfficeXlsxBorderSchema, z.null()]).optional(),
  borderBottom: z.union([genOfficeXlsxBorderSchema, z.null()]).optional(),
  borderLeft: z.union([genOfficeXlsxBorderSchema, z.null()]).optional(),
  borderRight: z.union([genOfficeXlsxBorderSchema, z.null()]).optional(),
})

/** host.saveGenOfficeXlsxArtifact request payload. */
export const hostSaveGenOfficeXlsxArtifactRequestSchema = z.object({
  sessionId: sessionIdSchema,
  grantId: z.uuid(),
  edits: z.array(z.object({
    sheetName: z.string().min(1),
    row: z.number().int().nonnegative().max(1_048_575),
    column: z.number().int().nonnegative().max(16_383),
    writeValue: z.boolean(),
    value: genOfficeXlsxCellValueSchema,
    formula: z.string().startsWith('=').max(8_192).optional(),
    style: genOfficeXlsxStyleSchema.optional(),
    styleReset: z.boolean().optional(),
  }).refine(edit => edit.writeValue || edit.style !== undefined || edit.styleReset === true)),
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<RequestPayload<'host.saveGenOfficeXlsxArtifact'>>>

/** host.prepareArtifactPreview response value. */
export const hostPrepareArtifactPreviewValueSchema = z.union([
  z.object({
    kind: z.literal('html'),
    name: z.string().min(1),
    url: z.string().startsWith('/api/artifact-preview/'),
    grantId: z.uuid(),
    content: z.string(),
    revision: z.string().length(64),
  }),
  z.object({
    kind: z.literal('markdown'),
    name: z.string().min(1),
    grantId: z.uuid(),
    content: z.string(),
    revision: z.string().length(64),
  }),
  z.object({
    kind: z.literal('genoffice-docx'),
    name: z.string().min(1),
    grantId: z.uuid(),
    blocks: z.array(genOfficeDocxBlockSchema),
    revision: z.string().length(64),
  }),
  z.object({
    kind: z.literal('genoffice-pptx'),
    name: z.string().min(1),
    grantId: z.uuid(),
    slides: z.array(genOfficePptxSlideSchema),
    revision: z.string().length(64),
  }),
  z.object({
    kind: z.literal('genoffice-xlsx'),
    name: z.string().min(1),
    grantId: z.uuid(),
    sheets: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      cells: z.array(z.object({
        address: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/),
        value: genOfficeXlsxCellValueSchema,
        formula: z.string().startsWith('=').max(8_192).optional(),
      })),
    })),
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

/** host.saveHtmlArtifact response value. */
export const hostSaveHtmlArtifactValueSchema = z.object({
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveHtmlArtifact'>>>

/** host.saveMarkdownArtifact response value. */
export const hostSaveMarkdownArtifactValueSchema = z.object({
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveMarkdownArtifact'>>>

/** host.saveGenOfficeDocxArtifact response value. */
export const hostSaveGenOfficeDocxArtifactValueSchema = z.object({
  revision: z.string().length(64),
  blocks: z.array(genOfficeDocxBlockSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveGenOfficeDocxArtifact'>>>

/** host.saveGenOfficePptxArtifact response value. */
export const hostSaveGenOfficePptxArtifactValueSchema = z.object({
  revision: z.string().length(64),
  slides: z.array(genOfficePptxSlideSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveGenOfficePptxArtifact'>>>

/** host.saveGenOfficeXlsxArtifact response value. */
export const hostSaveGenOfficeXlsxArtifactValueSchema = z.object({
  revision: z.string().length(64),
}) satisfies z.ZodType<Wire<ResponseValue<'host.saveGenOfficeXlsxArtifact'>>>
