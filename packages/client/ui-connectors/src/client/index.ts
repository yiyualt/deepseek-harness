/** Browser plugin contributing document connector cards to the sidebar. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  BrowserLoginConnectorController,
  ManagedMcpConnectorsController,
  QqMailConnectorController,
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
  'remote.qqMailConnector',
  'remote.mcpConnectors',
  'connection',
]

/** Register both document connector controllers, dictionaries, and sidebar action. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const credentials = connection.isLoopback ? connection.api : undefined
  const managedMcp = new ManagedMcpConnectorsController(ctx.remote.mcpConnectors, credentials)
  const kingsoftDocs = new BrowserLoginConnectorController(
    ctx.remote.kingsoftDocsConnector,
    connection.isLoopback,
  )
  const qqMail = new QqMailConnectorController(
    ctx.remote.qqMailConnector,
    credentials,
  )

  ctx.effect(() => {
    const disposeManagedMcp = ctx.remote.$on(
      'mcp-connectors/change',
      (snapshot) => { managedMcp.accept(snapshot) },
    )
    const disposeKingsoft = ctx.remote.$on(
      'kingsoft-docs-connector/change',
      (snapshot) => { kingsoftDocs.accept(snapshot) },
    )
    const disposeQqMail = ctx.remote.$on(
      'qq-mail-connector/change',
      (snapshot) => { qqMail.accept(snapshot) },
    )
    const disposeCredential = connection.isLoopback
      ? ctx.remote.$on('credentials/updated', (ref) => {
        managedMcp.credentialsUpdated(ref)
        qqMail.credentialsUpdated(ref)
      })
      : undefined
    return () => {
      disposeManagedMcp()
      disposeKingsoft()
      disposeQqMail()
      disposeCredential?.()
      managedMcp.dispose()
      kingsoftDocs.dispose()
      qqMail.dispose()
    }
  }, 'ui-connectors: controller lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-connectors: dictionaries')

  const injected = (): ConnectorsPanelInjected => ({
    hooks: {
      managedMcp: managedMcp.store,
      kingsoftDocs: kingsoftDocs.store,
      qqMail: qqMail.store,
    },
    open: () => {
      managedMcp.open()
      kingsoftDocs.open()
      qqMail.open()
    },
    close: () => {
      managedMcp.close()
      kingsoftDocs.close()
      qqMail.close()
    },
    setManagedDraft: (id, value) => { managedMcp.setDraft(id, value) },
    setQqMailDraft: (field, value) => { qqMail.setDraft(field, value) },
    connect: id => id === 'kingsoftDocs'
      ? kingsoftDocs.connect()
      : id === 'qqMail' ? qqMail.connect() : managedMcp.connect(id),
    disconnect: id => id === 'kingsoftDocs'
      ? kingsoftDocs.disconnect()
      : id === 'qqMail' ? qqMail.disconnect() : managedMcp.disconnect(id),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'connectors',
    order: -10,
    locale: NS,
    inject: injected,
  }, ConnectorsPanel))
}
