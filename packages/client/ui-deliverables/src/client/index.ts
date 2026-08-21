/**
 * Deliverables plugin, browser half: registers the produced-files row into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced files in the closing
 * prose. All policy lives here — the derivation from the mutation tools'
 * `locations`, the mention matching, the chip cap, and the copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { ArtifactPreviewPanel } from './ArtifactPreviewPanel.tsx'
import { ArtifactPreviewController } from './artifact-preview-controller.ts'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'deliverables': DeliverablesKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-layout/client' {
  interface DetailsPanelMap {
    /** HTML, Markdown, and DOCX artifact preview. */
    'artifact-preview': unknown
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { producedForClosing } from './turn-deliverables.ts'

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'conversationEvents', 'connection', 'layout']

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const preview = new ArtifactPreviewController(connection.api, ctx.layout)
  ctx.conversationEvents.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedFiles,
      locale: NS,
      inject: () => ({
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
      }),
    }, ProducedFiles),
  )
  ctx.slots.inject(
    'details',
    () => ctx.slots.register({
      name: 'details',
      select: owner => owner.panel === 'artifact-preview' ? owner : null,
      locale: NS,
      inject: sessionId => ({
        hooks: { preview: preview.sourceFor(sessionId) },
        activatePreview: (id) => { preview.activate(sessionId, id) },
        newPreviewTab: () => { preview.newTab(sessionId) },
        openPreviewUrl: (id, url) => preview.openUrl(sessionId, id, url),
        editMarkdown: (id, content) => { preview.editMarkdown(sessionId, id, content) },
        saveMarkdown: (id) => { void preview.saveMarkdown(sessionId, id) },
        closePreviewTab: (id) => { preview.close(sessionId, id) },
        closePreview: () => { ctx.layout.closeDetails() },
      }),
    }, ArtifactPreviewPanel),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      // The row remains mutation-location based. The prose resolver also
      // accepts exact DOCX and Markdown paths because terminal-created output
      // has no mutation location to contribute.
      const paths = selectProducedFiles(owner) ?? []
      return producedFileMentions(paths, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
  ctx.provide('chatFilePreview', preview)
}
