/** Browser plugin contributing the Connectors action and Tencent Docs panel to the sidebar. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ConnectorsPanelController } from './controller.ts'
import { ConnectorsPanel, type ConnectorsPanelInjected } from './ConnectorsPanel.tsx'
import { en, NS, zh, type ConnectorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connector management panel copy. */
    connectors: ConnectorKey
  }
}

/** Services required by the connectors sidebar contribution. */
export const inject = ['slots', 'locale', 'remote', 'remote.tencentDocsConnector', 'connection']

/** Register the controller, pushed state, dictionaries, and sidebar action. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ConnectorsPanelController(
    ctx.remote.tencentDocsConnector,
    connection.isLoopback ? connection.api : undefined,
  )
  ctx.effect(() => {
    const disposeConnector = ctx.remote.$on(
      'tencent-docs-connector/change',
      (snapshot) => { controller.accept(snapshot) },
    )
    const disposeCredential = connection.isLoopback
      ? ctx.remote.$on('credentials/updated', (ref) => { controller.credentialsUpdated(ref) })
      : undefined
    return () => {
      disposeConnector()
      disposeCredential?.()
      controller.dispose()
    }
  }, 'ui-connectors: controller lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-connectors: dictionaries')

  const injected = (): ConnectorsPanelInjected => ({
    hooks: { connectors: controller.store },
    open: () => { controller.open() },
    close: () => { controller.close() },
    setDraft: (value) => { controller.setDraft(value) },
    clearDraft: () => { controller.clearDraft() },
    connect: () => controller.connect(),
    disconnect: () => controller.disconnect(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'connectors',
    order: -10,
    locale: NS,
    inject: injected,
  }, ConnectorsPanel))
}
