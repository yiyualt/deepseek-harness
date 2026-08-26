/** React-free controller for the connectors sidebar panel. */

import type {
  ClientRemote,
  IApiClient,
  KingsoftDocsConnectorEventSnapshot,
  KingsoftDocsConnectorSnapshot,
  McpConnectorId,
  McpConnectorPresentation,
  McpConnectorPublicView,
  McpConnectorSnapshot,
  McpConnectorView,
  McpConnectorsPublicSnapshot,
  QqMailConnectorEventSnapshot,
  QqMailConnectorSnapshot,
  RpcResponse,
  TencentDocsConnectorEventSnapshot,
  TencentDocsConnectorSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Credential reference used by the Tencent Docs MCP connector. */
export const TENCENT_DOCS_CREDENTIAL_REF = 'TENCENT_DOCS_MCP_TOKEN'

type ConnectorSnapshot = TencentDocsConnectorSnapshot
type ConnectorEventSnapshot = TencentDocsConnectorEventSnapshot
type ConnectorRemote = ClientRemote['tencentDocsConnector']
type BrowserLoginRemote = ClientRemote['kingsoftDocsConnector']
type QqMailRemote = ClientRemote['qqMailConnector']
type ManagedMcpRemote = ClientRemote['mcpConnectors']

/** Browser-local state for one declaratively configured hosted MCP product. */
export interface ManagedMcpConnectorCardState {
  readonly id: McpConnectorId
  readonly presentation: McpConnectorPresentation
  readonly credentialRef: string | null
  readonly connector: McpConnectorSnapshot
  readonly draft: string
  readonly pending: 'connect' | 'disconnect' | null
  readonly error: string | null
}

/** Browser-local state for the complete managed MCP connector catalog. */
export interface ManagedMcpConnectorsState {
  open: boolean
  loopback: boolean
  connectors: readonly ManagedMcpConnectorCardState[]
  error: string | null
}

/** Browser-local panel and mutation state joined with the Host snapshot. */
export interface ConnectorsPanelState {
  open: boolean
  draft: string
  pending: 'connect' | 'disconnect' | null
  error: string | null
  loopback: boolean
  connector: ConnectorSnapshot
}

/** Browser-local state for a connector whose credential never enters the page. */
export interface BrowserLoginConnectorState {
  open: boolean
  pending: 'connect' | 'disconnect' | null
  error: string | null
  loopback: boolean
  connector: KingsoftDocsConnectorSnapshot
}

/** Browser-local write-only drafts and value-free personal QQ Mail state. */
export interface QqMailConnectorState {
  open: boolean
  emailDraft: string
  authorizationCodeDraft: string
  pending: 'connect' | 'disconnect' | null
  error: string | null
  loopback: boolean
  connector: QqMailConnectorSnapshot
}

type MutationKind = Exclude<ConnectorsPanelState['pending'], null>

interface ActiveMutation {
  id: number
  kind: MutationKind
}

const INITIAL_CONNECTOR: ConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: false,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: new Date(0).toISOString(),
}

const ACTIVE_AFTER_DISCONNECT = new Set<ConnectorSnapshot['status']>([
  'connecting',
  'connected',
  'reconnecting',
])

const INITIAL_BROWSER_LOGIN_CONNECTOR: KingsoftDocsConnectorSnapshot = {
  status: 'disconnected',
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: new Date(0).toISOString(),
}

const INITIAL_QQ_MAIL_CONNECTOR: QqMailConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: false,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: new Date(0).toISOString(),
}

const BROWSER_ACTIVE_AFTER_DISCONNECT = new Set<KingsoftDocsConnectorSnapshot['status']>([
  'connecting',
  'connected',
])

/** Stable UI-owned failure code for a connector request whose carrier did not settle. */
export const CONNECTOR_REQUEST_FAILED = 'CLIENT_REQUEST_FAILED'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unwrapRpc<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

const EMPTY_MCP_SNAPSHOT: McpConnectorSnapshot = {
  status: 'disconnected',
  credentialConfigured: false,
  credentialSource: null,
  credentialWritable: false,
  toolCount: 0,
  errorCode: null,
  errorMessage: null,
  updatedAt: new Date(0).toISOString(),
}

function publicCard(
  view: McpConnectorPublicView,
  previous: ManagedMcpConnectorCardState | undefined,
): ManagedMcpConnectorCardState {
  return {
    id: view.id,
    presentation: view.presentation,
    credentialRef: previous?.credentialRef ?? null,
    connector: { ...(previous?.connector ?? EMPTY_MCP_SNAPSHOT), ...view.snapshot },
    draft: previous?.draft ?? '',
    pending: previous?.pending ?? null,
    error: previous?.error ?? null,
  }
}

function fullCard(
  view: McpConnectorView,
  previous: ManagedMcpConnectorCardState | undefined,
): ManagedMcpConnectorCardState {
  return {
    id: view.id,
    presentation: view.presentation,
    credentialRef: view.credentialRef,
    connector: view.snapshot,
    draft: previous?.draft ?? '',
    pending: previous?.pending ?? null,
    error: previous?.error ?? null,
  }
}

/** Owns the dynamic catalog of Token-authenticated hosted MCP connector cards. */
export class ManagedMcpConnectorsController {
  /** Observable catalog state rendered by the connectors panel. */
  readonly store: SnapshotStore<ManagedMcpConnectorsState>

  private disposed = false
  private refreshSequence = 0
  private mutationSequence = 0
  private readonly activeMutations = new Map<McpConnectorId, number>()

  /**
   * @param remote - generic managed MCP connector Remote namespace.
   * @param credentials - loopback-only credential wire face; absent makes every card read-only.
   */
  constructor(
    private readonly remote: ManagedMcpRemote,
    private readonly credentials: Pick<IApiClient, 'credentials'> | undefined,
  ) {
    this.store = createSnapshotStore({
      open: false,
      loopback: credentials !== undefined,
      connectors: [],
      error: null,
    })
  }

  /** Open the panel and load the complete loopback or value-free public catalog. */
  open(): void {
    if (this.disposed) return
    this.store.update((state) => { state.open = true })
    void this.refresh()
  }

  /** Close the panel and erase all browser-held credential drafts. */
  close(): void {
    this.refreshSequence += 1
    this.store.update((state) => {
      state.open = false
      state.connectors = state.connectors.map(connector => ({ ...connector, draft: '' }))
    })
  }

  /**
   * Replace one browser-local credential draft.
   * @param id - configured connector identity.
   * @param value - current credential input.
   */
  setDraft(id: McpConnectorId, value: string): void {
    if (this.credentials === undefined) return
    this.updateCard(id, card => ({ ...card, draft: value, error: null }))
  }

  /**
   * Merge a value-free public catalog pushed by the Host.
   * @param snapshot - current public managed-MCP catalog.
   */
  accept(snapshot: McpConnectorsPublicSnapshot): void {
    if (this.disposed) return
    this.refreshSequence += 1
    this.store.update((state) => {
      state.connectors = snapshot.connectors.map(view => publicCard(
        view,
        state.connectors.find(candidate => candidate.id === view.id),
      ))
      state.error = null
    })
  }

  /**
   * Re-read a connector when its opaque credential reference changes.
   * @param ref - credential reference named by `credentials/updated`.
   */
  credentialsUpdated(ref: string): void {
    const state = this.store.getSnapshot()
    if (this.disposed || this.credentials === undefined || !state.open) return
    if (!state.connectors.some(connector => connector.credentialRef === ref)) return
    void this.refresh()
  }

  /**
   * Save an optional credential draft and connect one hosted MCP product.
   * @param id - configured connector identity.
   */
  async connect(id: McpConnectorId): Promise<void> {
    const card = this.card(id)
    if (this.disposed || this.credentials === undefined || card === undefined || card.pending !== null) return
    /* v8 ignore next -- a loopback catalog always carries the Host-validated credential reference. */
    if (card.credentialRef === null) return
    const value = card.draft.trim()
    if (value === '' && !card.connector.credentialConfigured) return
    const mutation = this.beginMutation(id, 'connect')
    try {
      if (value !== '') {
        unwrapRpc(await this.credentials.credentials.set({ ref: card.credentialRef, value }))
        if (!this.isActive(id, mutation)) return
      }
      const response = await this.remote.connect(id)
      if (!this.isActive(id, mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.applyFullView(response.value)
    } catch (error: unknown) {
      if (this.isActive(id, mutation)) this.updateCard(id, current => ({
        ...current,
        error: errorMessage(error),
      }))
    } finally {
      this.settleMutation(id, mutation)
    }
  }

  /**
   * Disconnect one hosted MCP product and remove a writable credential.
   * @param id - configured connector identity.
   */
  async disconnect(id: McpConnectorId): Promise<void> {
    const card = this.card(id)
    if (this.disposed || this.credentials === undefined || card === undefined || card.pending !== null) return
    const mutation = this.beginMutation(id, 'disconnect')
    try {
      const response = await this.remote.disconnect(id)
      if (!this.isActive(id, mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.applyFullView(response.value)
      if (response.value.snapshot.credentialWritable) {
        unwrapRpc(await this.credentials.credentials.unset({ ref: response.value.credentialRef }))
        if (this.isActive(id, mutation)) await this.refresh()
      }
    } catch (error: unknown) {
      if (this.isActive(id, mutation)) this.updateCard(id, current => ({
        ...current,
        error: errorMessage(error),
      }))
    } finally {
      this.settleMutation(id, mutation)
    }
  }

  /** Ignore late Remote settlements after the plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.refreshSequence += 1
    this.activeMutations.clear()
    this.store.update((state) => {
      state.connectors = state.connectors.map(connector => ({ ...connector, draft: '' }))
    })
  }

  private card(id: McpConnectorId): ManagedMcpConnectorCardState | undefined {
    return this.store.getSnapshot().connectors.find(connector => connector.id === id)
  }

  private updateCard(
    id: McpConnectorId,
    update: (card: ManagedMcpConnectorCardState) => ManagedMcpConnectorCardState,
  ): void {
    this.store.update((state) => {
      state.connectors = state.connectors.map(card => card.id === id ? update(card) : card)
    })
  }

  private beginMutation(id: McpConnectorId, pending: 'connect' | 'disconnect'): number {
    const mutation = ++this.mutationSequence
    this.activeMutations.set(id, mutation)
    this.refreshSequence += 1
    this.updateCard(id, card => ({ ...card, draft: '', pending, error: null }))
    return mutation
  }

  private settleMutation(id: McpConnectorId, mutation: number): void {
    if (!this.isActive(id, mutation)) return
    this.activeMutations.delete(id)
    this.updateCard(id, card => ({ ...card, pending: null }))
  }

  private isActive(id: McpConnectorId, mutation: number): boolean {
    return !this.disposed && this.activeMutations.get(id) === mutation
  }

  private applyFullView(view: McpConnectorView): void {
    this.refreshSequence += 1
    this.updateCard(view.id, card => fullCard(view, card))
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence
    try {
      if (this.credentials === undefined) {
        const response = await this.remote.publicList()
        if (!response.ok) throw new Error(response.error.message)
        if (this.disposed || sequence !== this.refreshSequence) return
        this.store.update((state) => {
          state.connectors = response.value.connectors.map(view => publicCard(
            view,
            state.connectors.find(candidate => candidate.id === view.id),
          ))
          state.error = null
        })
      } else {
        const response = await this.remote.list()
        if (!response.ok) throw new Error(response.error.message)
        if (this.disposed || sequence !== this.refreshSequence) return
        this.store.update((state) => {
          state.connectors = response.value.connectors.map(view => fullCard(
            view,
            state.connectors.find(candidate => candidate.id === view.id),
          ))
          state.error = null
        })
      }
    } catch (error: unknown) {
      if (this.disposed || sequence !== this.refreshSequence) return
      this.store.update((state) => { state.error = errorMessage(error) })
    }
  }
}

/** Owns one connector card's Remote calls and write-only Token transport. */
export class ConnectorsPanelController {
  /** Observable complete state rendered by the slot contribution. */
  readonly store: SnapshotStore<ConnectorsPanelState>

  private disposed = false
  private lifecycleSequence = 0
  private credentialSequence = 0
  private mutationSequence = 0
  private activeMutation: ActiveMutation | null = null
  private settledMutation: MutationKind | null = null
  private carrierFailedMutation: MutationKind | null = null

  /**
   * @param remote - one document connector Remote namespace.
   * @param credentials - loopback-only credential wire face; absent makes the controller read-only.
   * @param credentialRef - Host credential reference owned by this connector.
   */
  constructor(
    private readonly remote: ConnectorRemote,
    private readonly credentials: Pick<IApiClient, 'credentials'> | undefined,
    private readonly credentialRef: string,
  ) {
    this.store = createSnapshotStore({
      open: false,
      draft: '',
      pending: null,
      error: null,
      loopback: credentials !== undefined,
      connector: INITIAL_CONNECTOR,
    })
  }

  /** Open the panel and reconcile complete loopback or public non-loopback state. */
  open(): void {
    if (this.disposed) return
    this.store.update((state) => { state.open = true })
    if (this.credentials === undefined) void this.refreshPublic()
    else void this.refresh(this.credentials)
  }

  /** Close the panel and discard the browser-held Token draft. */
  close(): void {
    this.lifecycleSequence += 1
    this.credentialSequence += 1
    this.store.update((state) => {
      state.open = false
      state.draft = ''
    })
  }

  /**
   * Replace the browser-local write-only Token draft.
   * @param value - current Token input.
   */
  setDraft(value: string): void {
    if (this.credentials === undefined) return
    this.store.update((state) => {
      state.draft = value
      state.error = null
    })
  }

  /** Remove the Token draft from browser state without mutating the Host. */
  clearDraft(): void {
    this.store.update((state) => { state.draft = '' })
  }

  /**
   * Re-read value-free credential metadata after its forwarded Host invalidation.
   * @param ref - credential reference named by `credentials/updated`.
   */
  credentialsUpdated(ref: string): void {
    if (this.disposed
      || this.credentials === undefined
      || !this.store.getSnapshot().open
      || ref !== this.credentialRef) return
    void this.refreshCredential(this.credentials)
  }

  /**
   * Merge one Host-pushed value-free connector snapshot into locally known credential metadata.
   * @param snapshot - latest public Host state, or a full Remote response with the same public fields.
   */
  accept(snapshot: ConnectorEventSnapshot): void {
    if (this.disposed || this.isSettledPrecursor(snapshot.status)) return
    this.lifecycleSequence += 1
    this.applyLifecycle(snapshot)
    this.advanceSettledMutation(snapshot.status)
  }

  /** Store a new Token when supplied, then ask the Host connector to connect. */
  async connect(): Promise<void> {
    const current = this.store.getSnapshot()
    if (this.disposed || this.credentials === undefined || current.pending !== null) return
    const token = current.draft.trim()
    if (token === '' && !current.connector.credentialConfigured) return
    const mutation = this.beginMutation('connect')
    let connectorRequested = false
    try {
      if (token !== '') {
        unwrapRpc(await this.credentials.credentials.set({ ref: this.credentialRef, value: token }))
        if (!this.isActive(mutation)) return
        this.credentialSequence += 1
        this.applyCredential({ configured: true, source: null, writable: true })
      }
      connectorRequested = true
      const response = await this.remote.connect()
      if (!this.isActive(mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.commitMutation(mutation, response.value)
    } catch (error: unknown) {
      if (this.isActive(mutation)) {
        if (connectorRequested) this.reportConnectorRequestFailure(mutation, error)
        else this.reportFailure(error)
      }
    } finally {
      this.settleMutation(mutation)
    }
  }

  /** Disconnect first, then remove the credential only when its winning source is writable. */
  async disconnect(): Promise<void> {
    const current = this.store.getSnapshot()
    if (this.disposed || this.credentials === undefined || current.pending !== null) return
    const mutation = this.beginMutation('disconnect')
    let connectorSettled = false
    try {
      const response = await this.remote.disconnect()
      if (!this.isActive(mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.commitMutation(mutation, response.value)
      connectorSettled = true
      if (response.value.credentialWritable) {
        unwrapRpc(await this.credentials.credentials.unset({ ref: this.credentialRef }))
        if (!this.isActive(mutation)) return
        await this.refreshCredential(this.credentials)
      }
    } catch (error: unknown) {
      if (this.isActive(mutation)) {
        if (connectorSettled) this.reportFailure(error)
        else this.reportConnectorRequestFailure(mutation, error)
      }
    } finally {
      this.settleMutation(mutation)
    }
  }

  /** Ignore late Remote settlements after the plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.lifecycleSequence += 1
    this.credentialSequence += 1
    this.activeMutation = null
    this.carrierFailedMutation = null
    this.clearDraft()
  }

  private reportFailure(error: unknown): void {
    this.store.update((state) => { state.error = errorMessage(error) })
  }

  /** Record a connector carrier failure and converge its matching transition. */
  private reportConnectorRequestFailure(mutation: ActiveMutation, error: unknown): void {
    const expectedStatus = this.expectedStatus(mutation.kind)
    if (this.store.getSnapshot().connector.status !== expectedStatus) {
      this.carrierFailedMutation = mutation.kind
      this.reportFailure(error)
      return
    }
    this.failConnectorRequest(mutation.kind)
  }

  private failConnectorRequest(kind: MutationKind): void {
    this.lifecycleSequence += 1
    this.settledMutation = kind
    this.carrierFailedMutation = null
    this.store.update((state) => {
      state.connector = {
        ...state.connector,
        status: 'failed',
        toolCount: 0,
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      }
      state.error = null
    })
  }

  private beginMutation(kind: MutationKind): ActiveMutation {
    const mutation = { id: ++this.mutationSequence, kind }
    this.activeMutation = mutation
    this.settledMutation = null
    this.carrierFailedMutation = null
    // A mutation result is authoritative over reads that began before it.
    this.lifecycleSequence += 1
    this.credentialSequence += 1
    this.store.update((state) => {
      state.pending = kind
      state.error = null
      state.draft = ''
    })
    return mutation
  }

  private isActive(mutation: ActiveMutation): boolean {
    return !this.disposed && this.activeMutation?.id === mutation.id
  }

  private commitMutation(mutation: ActiveMutation, snapshot: ConnectorSnapshot): void {
    this.lifecycleSequence += 1
    this.credentialSequence += 1
    this.settledMutation = mutation.kind
    this.store.update((state) => {
      state.connector = snapshot
      state.error = null
    })
  }

  private settleMutation(mutation: ActiveMutation): void {
    if (!this.isActive(mutation)) return
    this.activeMutation = null
    this.store.update((state) => { state.pending = null })
  }

  private isSettledPrecursor(status: ConnectorSnapshot['status']): boolean {
    const current = this.store.getSnapshot().connector.status
    if (this.settledMutation === 'connect' && status === 'connecting') {
      return current !== 'disconnected'
    }
    if (this.settledMutation === 'disconnect' && status === 'disconnecting') {
      return current !== 'connected' && current !== 'reconnecting'
    }
    return false
  }

  private advanceSettledMutation(status: ConnectorSnapshot['status']): void {
    const reachedNewState = (this.settledMutation === 'connect' && status === 'disconnected')
      || (this.settledMutation === 'disconnect' && ACTIVE_AFTER_DISCONNECT.has(status))
    if (reachedNewState) this.settledMutation = null
  }

  private applyLifecycle(snapshot: ConnectorEventSnapshot): void {
    if (this.carrierFailedMutation !== null) {
      const failedKind = this.carrierFailedMutation
      if (snapshot.status === this.expectedStatus(failedKind)) {
        this.failConnectorRequest(failedKind)
        return
      }
      this.carrierFailedMutation = null
    }
    this.store.update((state) => {
      state.connector = { ...state.connector, ...snapshot }
      state.error = null
    })
  }

  private expectedStatus(kind: MutationKind): ConnectorSnapshot['status'] {
    return kind === 'connect' ? 'connecting' : 'disconnecting'
  }

  private applyCredential(credential: { configured: boolean; source?: string | null; writable: boolean }): void {
    this.store.update((state) => {
      state.connector = {
        ...state.connector,
        credentialConfigured: credential.configured,
        credentialSource: credential.source ?? null,
        credentialWritable: credential.writable,
      }
    })
  }

  private async refresh(credentials: Pick<IApiClient, 'credentials'>): Promise<void> {
    const lifecycleSequence = ++this.lifecycleSequence
    const credentialSequence = ++this.credentialSequence
    try {
      const [response, credentialResponse] = await Promise.all([
        this.remote.get(),
        credentials.credentials.describe({ refs: [this.credentialRef] }),
      ])
      if (!response.ok) throw new Error(response.error.message)
      const described = unwrapRpc(credentialResponse)
      const credential = described.credentials[this.credentialRef]
      if (this.disposed) return
      if (lifecycleSequence === this.lifecycleSequence) this.applyLifecycle(response.value)
      if (credentialSequence === this.credentialSequence) {
        this.applyCredential(credential ?? {
          configured: response.value.credentialConfigured,
          source: response.value.credentialSource,
          writable: response.value.credentialWritable,
        })
      }
    } catch (error: unknown) {
      if (!this.disposed
        && lifecycleSequence === this.lifecycleSequence
        && credentialSequence === this.credentialSequence) this.reportFailure(error)
    }
  }

  /** Reconcile credential-free lifecycle state for a non-loopback read-only panel. */
  private async refreshPublic(): Promise<void> {
    const sequence = ++this.lifecycleSequence
    try {
      const response = await this.remote.publicGet()
      if (!response.ok) throw new Error(response.error.message)
      if (this.disposed || sequence !== this.lifecycleSequence) return
      this.applyLifecycle(response.value)
    } catch (error: unknown) {
      if (!this.disposed && sequence === this.lifecycleSequence) this.reportFailure(error)
    }
  }

  private async refreshCredential(credentials: Pick<IApiClient, 'credentials'>): Promise<void> {
    const sequence = ++this.credentialSequence
    try {
      const described = unwrapRpc(
        await credentials.credentials.describe({ refs: [this.credentialRef] }),
      )
      if (this.disposed || sequence !== this.credentialSequence) return
      const credential = described.credentials[this.credentialRef]
      this.applyCredential(credential ?? {
        configured: false,
        writable: this.store.getSnapshot().connector.credentialWritable,
      })
    } catch (error: unknown) {
      if (!this.disposed && sequence === this.credentialSequence) this.reportFailure(error)
    }
  }
}

/** Owns one CLI-backed browser-login card without handling any credential value. */
export class BrowserLoginConnectorController {
  /** Observable complete state rendered by the slot contribution. */
  readonly store: SnapshotStore<BrowserLoginConnectorState>

  private disposed = false
  private lifecycleSequence = 0
  private mutationSequence = 0
  private activeMutation: ActiveMutation | null = null
  private settledMutation: MutationKind | null = null
  private carrierFailedMutation: MutationKind | null = null

  /**
   * @param remote - Structurally compatible browser-login Remote namespace.
   * @param loopback - whether this page may start or remove a local keychain login.
   */
  constructor(private readonly remote: BrowserLoginRemote, loopback: boolean) {
    this.store = createSnapshotStore({
      open: false,
      pending: null,
      error: null,
      loopback,
      connector: INITIAL_BROWSER_LOGIN_CONNECTOR,
    })
  }

  /** Open the panel and reconcile loopback or public lifecycle state. */
  open(): void {
    if (this.disposed) return
    this.store.update((state) => { state.open = true })
    void (this.store.getSnapshot().loopback ? this.refresh() : this.refreshPublic())
  }

  /** Close the panel and invalidate an outstanding state refresh. */
  close(): void {
    this.lifecycleSequence += 1
    this.store.update((state) => { state.open = false })
  }

  /**
   * Accept a credential-free lifecycle push from the Host.
   * @param snapshot - Latest public state from the selected CLI connector.
   */
  // oxlint-disable-next-line sonarjs/no-identical-functions -- Keep credential-free and credential-backed state ownership separate.
  accept(snapshot: KingsoftDocsConnectorEventSnapshot): void {
    if (this.disposed || this.isSettledPrecursor(snapshot.status)) return
    this.lifecycleSequence += 1
    this.applyLifecycle(snapshot)
    this.advanceSettledMutation(snapshot.status)
  }

  /** Ask the Host to reuse keychain authentication or open browser login. */
  async connect(): Promise<void> {
    const current = this.store.getSnapshot()
    if (this.disposed || !current.loopback || current.pending !== null) return
    const mutation = this.beginMutation('connect')
    try {
      const response = await this.remote.connect()
      if (!this.isActive(mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.commitMutation(mutation, response.value)
    } catch (error: unknown) {
      if (this.isActive(mutation)) this.reportConnectorRequestFailure(mutation, error)
    } finally {
      this.settleMutation(mutation)
    }
  }

  /** Ask the Host to remove the selected CLI connector's local authentication. */
  async disconnect(): Promise<void> {
    const current = this.store.getSnapshot()
    if (this.disposed || !current.loopback || current.pending !== null) return
    const mutation = this.beginMutation('disconnect')
    try {
      const response = await this.remote.disconnect()
      if (!this.isActive(mutation)) return
      if (!response.ok) throw new Error(response.error.message)
      this.commitMutation(mutation, response.value)
    } catch (error: unknown) {
      if (this.isActive(mutation)) this.reportConnectorRequestFailure(mutation, error)
    } finally {
      this.settleMutation(mutation)
    }
  }

  /** Ignore late Remote settlements after the plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.lifecycleSequence += 1
    this.activeMutation = null
    this.carrierFailedMutation = null
  }

  private beginMutation(kind: MutationKind): ActiveMutation {
    const mutation = { id: ++this.mutationSequence, kind }
    this.activeMutation = mutation
    this.settledMutation = null
    this.carrierFailedMutation = null
    this.lifecycleSequence += 1
    this.store.update((state) => {
      state.pending = kind
      state.error = null
    })
    return mutation
  }

  private isActive(mutation: ActiveMutation): boolean {
    return !this.disposed && this.activeMutation?.id === mutation.id
  }

  private commitMutation(mutation: ActiveMutation, snapshot: KingsoftDocsConnectorSnapshot): void {
    this.lifecycleSequence += 1
    this.settledMutation = mutation.kind
    this.store.update((state) => {
      state.connector = snapshot
      state.error = null
    })
  }

  // oxlint-disable-next-line sonarjs/no-identical-functions -- Each controller owns a different state store.
  private settleMutation(mutation: ActiveMutation): void {
    if (!this.isActive(mutation)) return
    this.activeMutation = null
    this.store.update((state) => { state.pending = null })
  }

  private reportConnectorRequestFailure(mutation: ActiveMutation, error: unknown): void {
    const expectedStatus = this.expectedStatus(mutation.kind)
    if (this.store.getSnapshot().connector.status !== expectedStatus) {
      this.carrierFailedMutation = mutation.kind
      this.store.update((state) => { state.error = errorMessage(error) })
      return
    }
    this.failConnectorRequest(mutation.kind)
  }

  // oxlint-disable-next-line sonarjs/no-identical-functions -- Each controller projects into its provider-specific snapshot.
  private failConnectorRequest(kind: MutationKind): void {
    this.lifecycleSequence += 1
    this.settledMutation = kind
    this.carrierFailedMutation = null
    this.store.update((state) => {
      state.connector = {
        ...state.connector,
        status: 'failed',
        toolCount: 0,
        errorCode: CONNECTOR_REQUEST_FAILED,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      }
      state.error = null
    })
  }

  private isSettledPrecursor(status: KingsoftDocsConnectorSnapshot['status']): boolean {
    const current = this.store.getSnapshot().connector.status
    if (this.settledMutation === 'connect' && status === 'connecting') {
      return current !== 'disconnected'
    }
    if (this.settledMutation === 'disconnect' && status === 'disconnecting') {
      return current !== 'connected'
    }
    return false
  }

  private advanceSettledMutation(status: KingsoftDocsConnectorSnapshot['status']): void {
    const reachedNewState = (this.settledMutation === 'connect' && status === 'disconnected')
      || (this.settledMutation === 'disconnect' && BROWSER_ACTIVE_AFTER_DISCONNECT.has(status))
    if (reachedNewState) this.settledMutation = null
  }

  private applyLifecycle(snapshot: KingsoftDocsConnectorEventSnapshot): void {
    if (this.carrierFailedMutation !== null) {
      const failedKind = this.carrierFailedMutation
      if (snapshot.status === this.expectedStatus(failedKind)) {
        this.failConnectorRequest(failedKind)
        return
      }
      this.carrierFailedMutation = null
    }
    this.store.update((state) => {
      state.connector = snapshot
      state.error = null
    })
  }

  private expectedStatus(kind: MutationKind): KingsoftDocsConnectorSnapshot['status'] {
    return kind === 'connect' ? 'connecting' : 'disconnecting'
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.lifecycleSequence
    try {
      const response = await this.remote.get()
      if (!response.ok) throw new Error(response.error.message)
      if (this.disposed || sequence !== this.lifecycleSequence) return
      this.applyLifecycle(response.value)
    } catch (error: unknown) {
      if (!this.disposed && sequence === this.lifecycleSequence) {
        this.store.update((state) => { state.error = errorMessage(error) })
      }
    }
  }

  private async refreshPublic(): Promise<void> {
    const sequence = ++this.lifecycleSequence
    try {
      const response = await this.remote.publicGet()
      if (!response.ok) throw new Error(response.error.message)
      if (this.disposed || sequence !== this.lifecycleSequence) return
      this.applyLifecycle(response.value)
    } catch (error: unknown) {
      if (!this.disposed && sequence === this.lifecycleSequence) {
        this.store.update((state) => { state.error = errorMessage(error) })
      }
    }
  }
}

/** Owns the personal QQ Mail address and authorization-code connection card. */
export class QqMailConnectorController {
  /** Observable complete state rendered by the connectors panel. */
  readonly store: SnapshotStore<QqMailConnectorState>

  private disposed = false
  private sequence = 0
  private mutationSequence = 0

  /**
   * @param remote - Personal QQ Mail Remote namespace.
   * @param credentials - Loopback-only credential API; absent makes the card read-only.
   */
  constructor(
    private readonly remote: QqMailRemote,
    private readonly credentials: Pick<IApiClient, 'credentials'> | undefined,
  ) {
    this.store = createSnapshotStore({
      open: false,
      emailDraft: '',
      authorizationCodeDraft: '',
      pending: null,
      error: null,
      loopback: credentials !== undefined,
      connector: INITIAL_QQ_MAIL_CONNECTOR,
    })
  }

  /** Open the card and reconcile complete loopback or public state. */
  // oxlint-disable-next-line sonarjs/no-identical-functions -- Each provider controller owns independent refresh sequencing.
  open(): void {
    if (this.disposed) return
    this.store.update((state) => { state.open = true })
    void this.refresh()
  }

  /** Close the card and erase both browser-held credential drafts. */
  close(): void {
    this.sequence += 1
    this.store.update((state) => {
      state.open = false
      state.emailDraft = ''
      state.authorizationCodeDraft = ''
    })
  }

  /**
   * Replace one browser-local credential draft.
   * @param field - Email address or authorization-code draft.
   * @param value - Current input value.
   */
  setDraft(field: 'email' | 'authorizationCode', value: string): void {
    if (this.credentials === undefined) return
    this.store.update((state) => {
      if (field === 'email') state.emailDraft = value
      else state.authorizationCodeDraft = value
      state.error = null
    })
  }

  /**
   * Merge credential-free lifecycle state pushed by the Host.
   * @param snapshot - Current public personal QQ Mail state.
   */
  accept(snapshot: QqMailConnectorEventSnapshot): void {
    if (this.disposed) return
    this.sequence += 1
    this.store.update((state) => {
      state.connector = { ...state.connector, ...snapshot }
      state.error = null
    })
  }

  /**
   * Re-read value-free metadata after either personal-mail credential changes.
   * @param ref - Credential reference named by `credentials/updated`.
   */
  credentialsUpdated(ref: string): void {
    if (!['QQ_MAIL_EMAIL', 'QQ_MAIL_AUTHORIZATION_CODE'].includes(ref)) return
    if (!this.disposed && this.store.getSnapshot().open) void this.refresh()
  }

  /** Save supplied drafts, verify IMAP authentication, and activate tools. */
  async connect(): Promise<void> {
    const state = this.store.getSnapshot()
    if (this.disposed || this.credentials === undefined || state.pending !== null) return
    const email = state.emailDraft.trim()
    const authorizationCode = state.authorizationCodeDraft.trim()
    if (!state.connector.credentialConfigured && (email === '' || authorizationCode === '')) return
    const mutation = ++this.mutationSequence
    this.sequence += 1
    this.store.update((current) => {
      current.pending = 'connect'
      current.error = null
      current.emailDraft = ''
      current.authorizationCodeDraft = ''
    })
    try {
      if (email !== '') unwrapRpc(await this.credentials.credentials.set({ ref: 'QQ_MAIL_EMAIL', value: email }))
      if (authorizationCode !== '') {
        unwrapRpc(await this.credentials.credentials.set({ ref: 'QQ_MAIL_AUTHORIZATION_CODE', value: authorizationCode }))
      }
      const response = await this.remote.connect()
      if (!response.ok) throw new Error(response.error.message)
      if (!this.isCurrentMutation(mutation)) return
      this.store.update((current) => { current.connector = response.value })
    } catch (error: unknown) {
      if (this.isCurrentMutation(mutation)) this.store.update((current) => { current.error = errorMessage(error) })
    } finally {
      if (this.isCurrentMutation(mutation)) this.store.update((current) => { current.pending = null })
    }
  }

  /** Disconnect tools, then remove both writable credential values. */
  async disconnect(): Promise<void> {
    const state = this.store.getSnapshot()
    if (this.disposed || this.credentials === undefined || state.pending !== null) return
    const mutation = ++this.mutationSequence
    this.sequence += 1
    this.store.update((current) => { current.pending = 'disconnect'; current.error = null })
    try {
      const response = await this.remote.disconnect()
      if (!response.ok) throw new Error(response.error.message)
      if (response.value.credentialWritable) {
        unwrapRpc(await this.credentials.credentials.unset({ ref: 'QQ_MAIL_EMAIL' }))
        unwrapRpc(await this.credentials.credentials.unset({ ref: 'QQ_MAIL_AUTHORIZATION_CODE' }))
      }
      if (!this.isCurrentMutation(mutation)) return
      const refreshed = await this.remote.get()
      if (!refreshed.ok) throw new Error(refreshed.error.message)
      if (this.isCurrentMutation(mutation)) this.store.update((current) => { current.connector = refreshed.value })
    } catch (error: unknown) {
      if (this.isCurrentMutation(mutation)) this.store.update((current) => { current.error = errorMessage(error) })
    } finally {
      if (this.isCurrentMutation(mutation)) this.store.update((current) => { current.pending = null })
    }
  }

  /** Ignore late settlements and erase browser-held credential drafts. */
  dispose(): void {
    this.disposed = true
    this.sequence += 1
    this.mutationSequence += 1
    this.store.update((state) => {
      state.emailDraft = ''
      state.authorizationCodeDraft = ''
    })
  }

  private isCurrentMutation(mutation: number): boolean {
    return !this.disposed && mutation === this.mutationSequence
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.sequence
    try {
      const response = this.credentials === undefined ? await this.remote.publicGet() : await this.remote.get()
      if (!response.ok) throw new Error(response.error.message)
      if (this.disposed || sequence !== this.sequence) return
      this.store.update((state) => {
        state.connector = { ...state.connector, ...response.value }
        state.error = null
      })
    } catch (error: unknown) {
      if (!this.disposed && sequence === this.sequence) this.store.update((state) => { state.error = errorMessage(error) })
    }
  }
}
