/** Browser plugin that contributes the Meetings action and presence panel to the sidebar. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MeetingPanelController } from './controller.ts'
import { MeetingPanel, type MeetingPanelInjected } from './MeetingPanel.tsx'
import { en, NS, zh, type MeetingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Meeting presence panel copy. */
    meeting: MeetingKey
  }
}

/** Services required by the meeting sidebar contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.meetingPresence']

/** Register the meeting controller, pushed state, and sidebar action. */
export function apply(ctx: ClientContext): void {
  const controller = new MeetingPanelController(ctx.remote)
  ctx.effect(() => {
    const disposeRemote = ctx.remote.$on('meeting-presence/change', (snapshot) => { controller.accept(snapshot) })
    return () => {
      disposeRemote()
      controller.dispose()
    }
  }, 'ui-meeting: controller lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-meeting: dictionaries')

  const injected = (): MeetingPanelInjected => ({
    hooks: { meeting: controller.store },
    open: () => { controller.open() },
    close: () => { controller.close() },
    setDraft: (value) => { controller.setDraft(value) },
    join: () => controller.join(),
    leave: () => controller.leave(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'meeting',
    order: 0,
    locale: NS,
    inject: injected,
  }, MeetingPanel))
}
