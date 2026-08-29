/** Package invariant companion for the Excel capability seam. @module @deepseek-ai/dsh-office-excel/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-office-excel'
export const name = 'office-excel-invariant'
export const inject = ['invariants']

/** No runtime invariant: provider ownership is private and enforced at registration and invocation. */
const install: InvariantInstaller = () => {}

/** Register package ownership. @param ctx - Context carrying invariants. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
