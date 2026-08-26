/** Browser plugin contributing document connector cards to the sidebar. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  BrowserLoginConnectorController,
  ConnectorsPanelController,
  TENCENT_DOCS_CREDENTIAL_REF,
} from './controller.ts'
import {
  ConnectorsPanel,
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
  const tencentDocs = new ConnectorsPanelController(
    ctx.remote.tencentDocsConnector,
    credentials,
    TENCENT_DOCS_CREDENTIAL_REF,
  )
  const kingsoftDocs = new BrowserLoginConnectorController(
    ctx.remote.kingsoftDocsConnector,
    connection.isLoopback,
  )

  ctx.effect(() => {
    const disposeTencent = ctx.remote.$on(
      'tencent-docs-connector/change',
      (snapshot) => { tencentDocs.accept(snapshot) },
    )
    const disposeKingsoft = ctx.remote.$on(
      'kingsoft-docs-connector/change',
      (snapshot) => { kingsoftDocs.accept(snapshot) },
    )
    const disposeCredential = connection.isLoopback
      ? ctx.remote.$on('credentials/updated', (ref) => {
        tencentDocs.credentialsUpdated(ref)
      })
      : undefined
    return () => {
      disposeTencent()
      disposeKingsoft()
      disposeCredential?.()
      tencentDocs.dispose()
      kingsoftDocs.dispose()
    }
  }, 'ui-connectors: controller lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-connectors: dictionaries')

  const injected = (): ConnectorsPanelInjected => ({
    hooks: {
      tencentDocs: tencentDocs.store,
      kingsoftDocs: kingsoftDocs.store,
    },
    open: () => {
      tencentDocs.open()
      kingsoftDocs.open()
    },
    close: () => {
      tencentDocs.close()
      kingsoftDocs.close()
    },
    setTencentDraft: (value) => { tencentDocs.setDraft(value) },
    clearTencentDraft: () => { tencentDocs.clearDraft() },
    connect: id => id === 'tencentDocs' ? tencentDocs.connect() : kingsoftDocs.connect(),
    disconnect: id => id === 'tencentDocs' ? tencentDocs.disconnect() : kingsoftDocs.disconnect(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'connectors',
    order: -10,
    locale: NS,
    inject: injected,
  }, ConnectorsPanel))
}
