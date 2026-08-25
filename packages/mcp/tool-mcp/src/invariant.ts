/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-mcp`.
 * @module @deepseek-ai/dsh-tool-mcp/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-mcp'

/** Cordis companion plugin name. */
export const name = 'tool-mcp-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The consumer owns no public mutable service. Catalog membership and approval
 * routing are private to one scoped plugin instance and are checked at their
 * registration and dispatch points, so there is no additional cross-plugin
 * relationship for a runtime companion to assert.
 */
const install: InvariantInstaller = (_ctx: Context, _fail): void => {
  // No runtime invariant: catalog membership and approval routing are private
  // to one scoped plugin instance and are checked where they register or run.
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
