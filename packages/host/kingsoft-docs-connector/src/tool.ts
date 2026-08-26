/** Preset-scoped model tools backed by an authenticated `kdocs-cli`. */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  KDOCS_CLI_SERVICES,
  type KdocsCliService,
  type KingsoftDocsConnectorGateway,
} from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-kingsoft-docs'

/** Services required before the scoped tools can be projected. */
export const inject = ['tools']

/** One-shot confirmation shown immediately before an authenticated CLI action. */
export const KINGSOFT_DOCS_APPROVAL_REASON =
  'Kingsoft Docs action may read local files or change external data'

const ACTION_NAME = /^[a-z][a-z0-9-]*$/

/** Require one audited user decision immediately before the CLI process starts. */
async function requireApproval(ctx: Context, exec: ToolRunContext): Promise<void> {
  const approval = ctx.get('approval')
  if (approval === undefined) {
    throw new Error(`tool "${exec.name}" requires approval, but no approval service is available`)
  }
  if (exec.agent === undefined) {
    throw new Error(`tool "${exec.name}" requires approval, but the call has no agent to route it through`)
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason: KINGSOFT_DOCS_APPROVAL_REASON,
    signal: exec.signal,
  })
  switch (outcome) {
    case 'allowed-once': return
    case 'rejected': throw new Error(`the user rejected tool "${exec.name}"`)
    case 'cancelled': throw new Error(`approval for tool "${exec.name}" was cancelled`)
    case 'unavailable': throw new Error(`tool "${exec.name}" requires approval, but no approval channel is available`)
  }
}

/** Narrow the schema-validated service string to the provider vocabulary. */
function asService(value: string): KdocsCliService {
  return value as KdocsCliService
}

/** Keep the CLI action path separate from JSON parameters and shell parsing. */
function assertAction(value: string): void {
  if (!ACTION_NAME.test(value)) throw new TypeError('action must be a kebab-case kdocs-cli name')
}

/** Register both tools for one connected gateway generation. */
function registerTools(ctx: Context, gateway: KingsoftDocsConnectorGateway): () => void {
  const disposeHelp = ctx.tools.register(defineTool({
    name: 'kingsoft_docs_help',
    description:
      'Inspect the installed Kingsoft Docs CLI services or the exact parameters for one action. '
      + 'Call this before kingsoft_docs_call instead of guessing action names or parameters.',
    parameters: {
      service: {
        type: 'string',
        enum: [...KDOCS_CLI_SERVICES],
        description: 'Optional CLI service to inspect.',
      },
      action: {
        type: 'string',
        description: 'Optional kebab-case action under service. Requires service.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: gateway.toolCallTimeoutMs,
    async execute(args, exec) {
      if (args.action !== undefined) assertAction(args.action)
      return gateway.runHelp(
        args.service === undefined ? undefined : asService(args.service),
        args.action,
        exec.signal,
      )
    },
  }))

  const disposeCall = ctx.tools.register(defineTool({
    name: 'kingsoft_docs_call',
    description:
      'Execute one authenticated Kingsoft Docs CLI action. First use kingsoft_docs_help to obtain '
      + 'the exact service, action, and parameter names. Parameters are sent as JSON over stdin, never as shell text. '
      + 'Ask the user explicitly before irreversible delete or close actions, and verify writes with an independent read.',
    parameters: {
      service: {
        type: 'string',
        required: true,
        enum: [...KDOCS_CLI_SERVICES],
        description: 'Exact CLI service returned by kingsoft_docs_help.',
      },
      action: {
        type: 'string',
        required: true,
        description: 'Exact kebab-case action returned by kingsoft_docs_help.',
      },
      params: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'Action parameters using the exact names reported by help.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: gateway.toolCallTimeoutMs,
    async execute(args, exec): Promise<JsonValue> {
      assertAction(args.action)
      await requireApproval(ctx, exec)
      return gateway.runAction({
        service: asService(args.service),
        action: args.action,
        params: args.params,
        signal: exec.signal,
      })
    },
  }))

  return () => {
    disposeCall()
    disposeHelp()
  }
}

/** Project tools only while the process-wide Kingsoft Docs gateway is connected. */
export function apply(ctx: Context): void {
  ctx.inject(['kingsoftDocsConnector'], (scope) => {
    const gateway = scope.kingsoftDocsConnector
    let disposeTools: (() => void) | undefined

    const reconcile = (): void => {
      const connected = gateway.current().status === 'connected'
      if (connected && disposeTools === undefined) disposeTools = registerTools(scope, gateway)
      if (!connected && disposeTools !== undefined) {
        disposeTools()
        disposeTools = undefined
      }
    }

    scope.effect(() => () => { disposeTools?.() }, 'tool-kingsoft-docs.catalog')
    reconcile()
    scope.on('kingsoft-docs-connector/change', reconcile)
  })
}
