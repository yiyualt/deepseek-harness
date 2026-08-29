/** Package invariant companion for the Excel tool Consumer. @module @deepseek-ai/dsh-tool-excel/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-excel'
export const name = 'tool-excel-invariant'
export const inject = ['invariants']
/** No runtime invariant: tool registration lifecycle and execution relations are owned by the tools and Excel services. */
const install: InvariantInstaller = () => {}
/** Register package ownership. @param ctx - Context carrying invariants. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
