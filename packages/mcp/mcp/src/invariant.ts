/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp`.
 * @module @deepseek-ai/dsh-mcp/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp'

/** Cordis companion plugin name. */
export const name = 'mcp-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert that every `mcp/change` emission comes from a live service and carries
 * the exact committed revision currently readable from that service.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('mcp/change', (snapshot) => {
    const runtime = ctx.get('mcp')
    if (runtime === undefined) {
      fail(`mcp/change revision ${snapshot.revision} emitted without a live MCP service`)
      return
    }
    const current = runtime.snapshot()
    if (current.revision !== snapshot.revision) {
      fail(`mcp/change revision ${snapshot.revision} disagrees with current revision ${current.revision}`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
