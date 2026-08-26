# Dynamic MCP Connections

English | [中文](mcp.zh.md)

The MCP capability seam separates the [`McpRuntime` Service Definition](../../packages/mcp/mcp), the Host-owned [`mcp-client/runtime` Service Provider](../../packages/mcp/mcp-client/README.md#entry-points), and the preset-scoped [`tool-mcp` Consumer](../../packages/mcp/tool-mcp). The Service Definition moves safe connection state and canonical JSON tool calls without exposing transport clients or resolved credentials. The Provider owns process-wide transports; each Consumer decides which agent preset receives the discovered tools.

Sources: [`packages/mcp/mcp/src/types.ts`](../../packages/mcp/mcp/src/types.ts) · [`packages/mcp/mcp/src/index.ts`](../../packages/mcp/mcp/src/index.ts)

## Connection identity and transport

`McpServerName` is the stable local identity used in snapshots, calls, and model-facing names. Construct it with `mcpServerName(value)`, which accepts one to 32 ASCII letters, digits, `_`, or `-`; the remote server cannot choose or rename it.

```ts type-equiv
/** Stable, opaque identity of one configured MCP server connection. */
type McpServerName = Branded<'McpServerName'>
```

A name remains reserved while its entry is connecting, connected, reconnecting, failed, or disconnecting. Retrying or replacing it requires an awaited `disconnect` followed by `connect`.

```ts type-equiv
/** Lifecycle state of a server that is still present in the runtime snapshot. */
type McpServerStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnecting'
```

Authorization is separate from ordinary HTTP headers. The credential-backed variant resolves its reference for each HTTP request. `raw` sends the value verbatim; `bearer` prepends the standard `Bearer ` prefix. Replacing a credential affects the next request and does not itself reconnect the transport.

```ts type-equiv
/** Credential reference used to construct an HTTP `Authorization` header value. */
interface McpCredentialAuthorizationConfig {
  /** Selects credential-reference resolution. */
  readonly kind: 'credential'
  /** Reference resolved through `ctx.credentials` for each HTTP request. */
  readonly ref: CredentialRef
  /** Send the resolved value verbatim, or prepend the standard `Bearer ` scheme. */
  readonly scheme: 'raw' | 'bearer'
}
```

```ts type-equiv
/** Extensible authorization configuration for an MCP transport. */
type McpAuthorizationConfig = McpCredentialAuthorizationConfig
```

Stdio executes a command directly without shell interpolation. Its environment starts from the Provider's credential-scrubbed parent environment and then receives only explicitly configured entries. Streamable HTTP rejects credentials embedded in the URL, URL fragments, non-HTTP(S) schemes, and literal `Authorization` entries in `headers`.

```ts type-equiv
/** Child-process transport configuration for one MCP server. */
interface McpStdioTransportConfig {
  /** Selects a child process connected through stdin/stdout. */
  readonly kind: 'stdio'
  /** Executable invoked directly, without shell interpolation. */
  readonly command: string
  /** Arguments passed directly to the executable. */
  readonly args?: readonly string[]
  /** Additional process environment entries. */
  readonly env?: Readonly<Record<string, string>>
  /** Child-process working directory. */
  readonly cwd?: string
}
```

```ts type-equiv
/** Streamable HTTP transport configuration for one MCP server. */
interface McpStreamableHttpTransportConfig {
  /** Selects MCP Streamable HTTP. */
  readonly kind: 'streamable-http'
  /** Absolute MCP endpoint URL. */
  readonly url: string
  /** Non-authorization HTTP headers; providers reject `Authorization` here. */
  readonly headers?: Readonly<Record<string, string>>
  /** Optional credential-backed `Authorization` value. */
  readonly authorization?: McpAuthorizationConfig
}
```

```ts type-equiv
/** Supported MCP client transports. */
type McpTransportConfig = McpStdioTransportConfig | McpStreamableHttpTransportConfig
```

A connector may attach one Host-owned activation check. The Provider calls the named read-only tool after discovery but before the catalog becomes active, then runs the same-process classifier on a detached, credential-redacted result. It repeats this gate for reconnect generations. The callback and result never enter runtime snapshots.

```ts type-equiv
/** Outcome of a provider-specific tool call performed before catalog activation. */
type McpActivationCheckOutcome = 'accepted' | 'auth-rejected' | 'failed'
```

```ts type-equiv
/** Optional read-only tool call that must succeed before a catalog becomes active. */
interface McpActivationCheck {
  /** Raw MCP tool name invoked after discovery but before `connected` is published. */
  readonly toolName: string
  /** JSON arguments sent to the activation tool. */
  readonly args: Readonly<Record<string, JsonValue>>
  /** Complete activation-call timeout in milliseconds. */
  readonly timeoutMs: number
  /**
   * Classify the credential-free result without retaining provider data.
   * @param result - detached MCP result returned by the initializing client.
   * @returns whether the catalog may activate, authentication failed, or the result is unusable.
   */
  readonly classify: (result: McpResult) => McpActivationCheckOutcome
}
```

```ts type-equiv
/** Request to establish one named MCP connection. */
interface McpConnectRequest {
  /** Unique connection identity. */
  readonly serverName: McpServerName
  /** Transport used for this connection and every reconnect generation. */
  readonly transport: McpTransportConfig
  /** Optional read-only gate completed before each generation publishes its catalog. */
  readonly activationCheck?: McpActivationCheck
}
```

## Catalog and safe state

The Provider drains paginated `tools/list` responses into one catalog. Task support and MCP annotations remain server-supplied metadata; annotations never grant execution authority.

```ts type-equiv
/** MCP task-execution support advertised for one tool. */
type McpTaskSupport = 'forbidden' | 'optional' | 'required'
```

```ts type-equiv
/** Standard MCP safety annotations retained from a server tool descriptor. */
interface McpToolAnnotations {
  /** Server-provided hint that the tool does not modify its environment; not an authorization grant. */
  readonly readOnlyHint?: boolean
  /** Server-provided hint that the tool may perform destructive updates. */
  readonly destructiveHint?: boolean
  /** Server-provided hint that repeated calls with the same arguments have no additional effect. */
  readonly idempotentHint?: boolean
  /** Server-provided hint that the tool may interact with entities outside a closed local domain. */
  readonly openWorldHint?: boolean
}
```

```ts type-equiv
/** One tool advertised by the current generation of an MCP connection. */
interface McpToolDescriptor {
  /** Raw MCP name sent in `tools/call`. */
  readonly name: string
  /** Server-provided model-facing description. */
  readonly description: string
  /** Server-provided input JSON Schema. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** Optional server-provided output JSON Schema. */
  readonly outputSchema?: Readonly<Record<string, unknown>>
  /** Server-declared task-execution support. */
  readonly taskSupport?: McpTaskSupport
  /** Untrusted server-declared safety hints retained for information and audit. */
  readonly annotations?: McpToolAnnotations
}
```

Every committed lifecycle or catalog change increments the registry revision before `mcp/change`. Snapshots contain descriptors and fixed safe diagnostics, never transport clients, headers, or resolved credential values. A reconnecting entry may retain its last successful catalog for schema stability, but calls reject until the server is connected; authentication failure, exhausted recovery, and disconnecting clear the catalog.

```ts type-equiv
/** Safe public state for one MCP server that has not finished disconnecting. */
interface McpServerSnapshot {
  /** Stable connection identity. */
  readonly serverName: McpServerName
  /** Current connection lifecycle state. */
  readonly status: McpServerStatus
  /** Monotonic transport generation for this connection. */
  readonly generation: number
  /**
   * Last successfully advertised catalog. It may remain during `reconnecting`
   * for schema stability, but {@link McpRuntime.callTool} rejects until the
   * server returns to `connected`.
   */
  readonly tools: readonly McpToolDescriptor[]
  /** Provider-defined safe failure code, absent outside a reported failure. */
  readonly errorCode?: string
  /** Safe diagnostic message that never contains headers or credential values. */
  readonly errorMessage?: string
}
```

```ts type-equiv
/** Full safe state of the MCP connection registry. */
interface McpRuntimeSnapshot {
  /** Monotonic registry revision changed before every `mcp/change` emission. */
  readonly revision: number
  /** Every live, failed, or disconnecting connection; fully disconnected names are absent. */
  readonly servers: readonly McpServerSnapshot[]
}
```

## Calls and results

Calls name the current connection and raw server tool. The Provider rejects an absent, non-connected, or non-advertised target, propagates cancellation, and enforces the per-call timeout. The canonical result retains lossless JSON content and optional structured content; the Consumer owns the text-only model projection.

```ts type-equiv
/** Request to invoke a tool on the runtime's current connection generation. */
interface McpCallToolRequest {
  /** Connection whose current generation receives the call. */
  readonly serverName: McpServerName
  /** Raw MCP tool name. */
  readonly name: string
  /** JSON arguments sent in `tools/call`. */
  readonly args: Readonly<Record<string, JsonValue>>
  /** Caller cancellation propagated to the transport. */
  readonly signal: AbortSignal
  /** Timeout for this invocation in milliseconds. */
  readonly timeoutMs: number
}
```

```ts type-equiv
/** Canonical JSON result returned by an MCP tool call. */
interface McpResult {
  /** Lossless MCP content blocks. */
  readonly content: readonly JsonValue[]
  /** Optional structured result advertised by the tool. */
  readonly structuredContent?: JsonValue
  /** Whether the MCP server reported a tool-level failure. */
  readonly isError?: boolean
}
```

## Provider lifecycle and Consumer approval

The shipped Provider commits `connecting`, initializes a fresh transport generation, discovers the complete tool list, and commits either `connected` or a safe `failed` state. An established close enters bounded exponential recovery. Missing credentials and authentication rejection fail without retrying. Disconnect first publishes `disconnecting` with an empty catalog, closes the client and supported HTTP session, waits for catalog synchronization and in-flight calls, then removes the entry. Known credential values are replaced with `[REDACTED]` if a server echoes them in a result.

The Tencent Docs connector supplies an already-issued [space MCP Token](https://docs.qq.com/open/document/mcp/get-token/) through a raw credential reference. It does not perform login, account selection, or Token issuance. Kingsoft Docs uses the provider's official `kdocs-cli` browser-login flow and therefore sits outside this MCP seam; its lifecycle and model tools live in the [Kingsoft Docs Host package](../../packages/host/kingsoft-docs-connector/README.md).

Each `tool-mcp` Consumer atomically projects the safe catalog into one agent preset. Public names are deterministic `mcp__<serverName>__<rawName>` identities; the raw name alone goes to `tools/call`. A task-required tool fails before dispatch because task execution is unsupported.

Every executable MCP tool performs an audited [approval](approval.md) inside its executor immediately before `ctx.mcp.callTool`, so an earlier tool-pipeline `allow` cannot bypass the check. Only `allowed-once` reaches the transport. A missing approval service, a call without an agent, or any non-grant outcome fails closed. Remote annotations are never authority; a future exemption requires a separately reviewed Host-owned policy.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcp--mcpruntime-abstract-seam"></a>

### `ctx.mcp` — `McpRuntime` (abstract seam)

Abstract runtime for a dynamic registry of MCP server connections. Providers mutate their state before calling notifyChange; snapshots and diagnostics must never contain resolved credential values.

```ts cordis-catalog
/**
 * Start one connection and resolve after its initial attempt commits a
 * snapshot. A name still present in {@link snapshot}, including a failed or
 * disconnecting connection, is a duplicate and must be rejected. Retrying or
 * replacing a connection is therefore an explicit `disconnect` then
 * `connect` sequence.
 * @param request - stable name and transport configuration.
 * @returns the committed initial server state.
 */
abstract connect(request: McpConnectRequest): Promise<McpServerSnapshot>

/**
 * Remove one connection. Providers first publish `disconnecting` with an
 * empty tool catalog, close listeners, abort owned work, await transport
 * quiescence, then remove the server from the next snapshot. An unknown name
 * is a no-op.
 * @param serverName - connection to remove.
 * @returns completion after the connection is absent and owned work is quiescent.
 */
abstract disconnect(serverName: McpServerName): Promise<void>

/**
 * Read the complete safe registry state synchronously.
 * @returns the current immutable snapshot.
 */
abstract snapshot(): McpRuntimeSnapshot

/**
 * Invoke a raw MCP tool on the named connection's current generation. The
 * implementation propagates cancellation, enforces the per-call timeout,
 * and rejects when no connected generation currently advertises the name.
 * @param request - connection, raw name, JSON arguments, signal, and timeout.
 * @returns the canonical MCP tool result.
 */
abstract callTool(request: McpCallToolRequest): Promise<McpResult>
```

Source: [`packages/mcp/mcp/src/index.ts:64`](../../packages/mcp/mcp/src/index.ts)

<a id="mcp-events"></a>

### `mcp/*` events

<a id="mcpchange--emit"></a>

#### `mcp/change` — emit

Complete safe MCP registry snapshot after a connection status or catalog commit. Listener failures are contained by the emitting runtime, except synchronous `INVARIANT` failures, which rethrow after every listener ran. This is an unfiltered registry notification rather than an agent event.

```ts cordis-catalog
/**
 * Complete safe MCP registry snapshot after a connection status or catalog
 * commit. Listener failures are contained by the emitting runtime, except
 * synchronous `INVARIANT` failures, which rethrow after every listener ran.
 * This is an unfiltered registry notification rather than an agent event.
 * @param snapshot - complete state at the committed revision.
 * @mode emit
 */
'mcp/change'(snapshot: McpRuntimeSnapshot): void
```

Source: [`packages/mcp/mcp/src/types.ts:187`](../../packages/mcp/mcp/src/types.ts)

<a id="tencent-docs-connector-events"></a>

### `tencent-docs-connector/*` events

<a id="tencent-docs-connectorchange--emit"></a>

#### `tencent-docs-connector/change` — emit

The process-wide Tencent Docs connector changed public state.

```ts cordis-catalog
/**
 * The process-wide Tencent Docs connector changed public state.
 * @mode emit
 * @param snapshot Current value-free state after the transition.
 */
'tencent-docs-connector/change'(snapshot: TencentDocsConnectorEventSnapshot): void
```

Source: [`packages/host/tencent-docs-connector/src/types.ts:25`](../../packages/host/tencent-docs-connector/src/types.ts)
<!-- END GENERATED cordis-surface -->
