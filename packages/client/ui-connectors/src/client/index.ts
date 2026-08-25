/** Browser plugin contributing document connector cards to the sidebar. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  ConnectorsPanelController,
  KINGSOFT_DOCS_CREDENTIAL_REF,
  TENCENT_DOCS_CREDENTIAL_REF,
} from './controller.ts'
import {
  ConnectorsPanel,
  type ConnectorId,
  type ConnectorsPanelInjected,
} from './ConnectorsPanel.tsx'
import { en, NS, zh, type ConnectorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connector management panel copy. */
    connectors: ConnectorKey
  }
}

/** Services required by the connectors sidebar contribution. */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.kingsoftDocsConnector',
  'remote.tencentDocsConnector',
  'connection',
]

/** Register both document connector controllers, dictionaries, and sidebar action. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const credentials = connection.isLoopback ? connection.api : undefined
  const controllers: Record<ConnectorId, ConnectorsPanelController> = {
    tencentDocs: new ConnectorsPanelController(
      ctx.remote.tencentDocsConnector,
      credentials,
      TENCENT_DOCS_CREDENTIAL_REF,
    ),
    kingsoftDocs: new ConnectorsPanelController(
      ctx.remote.kingsoftDocsConnector,
      credentials,
      KINGSOFT_DOCS_CREDENTIAL_REF,
    ),
  }

  ctx.effect(() => {
    const disposeTencent = ctx.remote.$on(
      'tencent-docs-connector/change',
      (snapshot) => { controllers.tencentDocs.accept(snapshot) },
    )
    const disposeKingsoft = ctx.remote.$on(
      'kingsoft-docs-connector/change',
      (snapshot) => { controllers.kingsoftDocs.accept(snapshot) },
    )
    const disposeCredential = connection.isLoopback
      ? ctx.remote.$on('credentials/updated', (ref) => {
          controllers.tencentDocs.credentialsUpdated(ref)
          controllers.kingsoftDocs.credentialsUpdated(ref)
        })
      : undefined
    return () => {
      disposeTencent()
      disposeKingsoft()
      disposeCredential?.()
      controllers.tencentDocs.dispose()
      controllers.kingsoftDocs.dispose()
    }
  }, 'ui-connectors: controller lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-connectors: dictionaries')

  const injected = (): ConnectorsPanelInjected => ({
    hooks: {
      tencentDocs: controllers.tencentDocs.store,
      kingsoftDocs: controllers.kingsoftDocs.store,
    },
    open: () => {
      controllers.tencentDocs.open()
      controllers.kingsoftDocs.open()
    },
    close: () => {
      controllers.tencentDocs.close()
      controllers.kingsoftDocs.close()
    },
    setDraft: (id, value) => { controllers[id].setDraft(value) },
    clearDraft: (id) => { controllers[id].clearDraft() },
    connect: (id) => controllers[id].connect(),
    disconnect: (id) => controllers[id].disconnect(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'connectors',
    order: -10,
    locale: NS,
    inject: injected,
  }, ConnectorsPanel))
}
