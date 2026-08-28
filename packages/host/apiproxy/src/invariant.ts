/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-apiproxy`.
 * @module @deepseek-ai/dsh-host-apiproxy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './artifact-edit-awareness.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-apiproxy'

/** Cordis companion plugin name. */
export const name = 'host-apiproxy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate package-owned human-edit events and their delivery references. */
function validateArtifactEvent(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'artifact/edited') {
    if (event.data.path.length === 0 || !/^[0-9a-f]{64}$/.test(event.data.revision)) {
      fail(`artifact/edited event ${String(event.seq)} must carry a path and lowercase SHA-256 revision`)
    }
    return
  }
  if (event.type !== 'user/message' || event.data.source.kind !== 'artifact-edit') return
  const throughSeq = event.data.source.throughSeq
  const referenced = session.events.find(candidate => candidate.seq === throughSeq)
  if (referenced?.type !== 'artifact/edited' || referenced.seq >= event.seq) {
    fail(`artifact-edit message ${String(event.seq)} throughSeq must reference an earlier artifact/edited event`)
  }
}

/** Package-owned durable edit facts always have a valid delivery relationship. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateArtifactEvent(session, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
