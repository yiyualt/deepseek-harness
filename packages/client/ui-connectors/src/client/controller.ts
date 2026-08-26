/** React-free controller for the connectors sidebar panel. */

import type {
  ClientRemote,
  IApiClient,
  KingsoftDocsConnectorEventSnapshot,
  KingsoftDocsConnectorSnapshot,
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

/** Owns the Kingsoft Docs browser-login card without handling any credential value. */
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
   * @param remote - Kingsoft Docs browser-login Remote namespace.
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
   * @param snapshot - latest public Kingsoft Docs state.
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

  /** Ask the Host to remove Kingsoft Docs authentication from the system keychain. */
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
