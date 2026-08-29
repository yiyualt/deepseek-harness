/** Package invariant companion for the Excel WebSocket provider. @module @deepseek-ai/dsh-office-excel-websocket/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-office-excel-websocket'
export const name = 'office-excel-websocket-invariant'
export const inject = ['invariants']
/** No runtime invariant: connection ownership and pending-call settlement are private and tested at the provider boundary. */
const install: InvariantInstaller = () => {}
/** Register package ownership. @param ctx - Context carrying invariants. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
