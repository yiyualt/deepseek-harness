# 动态 MCP 连接

[English](mcp.md) | 中文

MCP 能力 seam 分离了 [`McpRuntime` Service Definition](../../packages/mcp/mcp)、Host 持有的 [`mcp-client/runtime` Service Provider](../../packages/mcp/mcp-client/README.md#entry-points)，以及限定在 preset 内的 [`tool-mcp` Consumer](../../packages/mcp/tool-mcp)。Service Definition 传递安全连接状态与规范 JSON 工具调用，但不暴露传输客户端或已解析凭据。Provider 持有进程级传输；每个 Consumer 决定哪个 agent preset 获得已发现工具。

源码：[`packages/mcp/mcp/src/types.ts`](../../packages/mcp/mcp/src/types.ts) · [`packages/mcp/mcp/src/index.ts`](../../packages/mcp/mcp/src/index.ts)

## 连接身份与传输

`McpServerName` 是快照、调用和面向模型名称使用的稳定本地身份。使用 `mcpServerName(value)` 构造它；该函数接受 1 至 32 个 ASCII 字母、数字、`_` 或 `-`，远端服务器不能选择或重命名它。

```ts type-equiv
/** Stable, opaque identity of one configured MCP server connection. */
type McpServerName = Branded<'McpServerName'>
```

只要条目处于 connecting、connected、reconnecting、failed 或 disconnecting，名称就保持预留。重试或替换必须先等待 `disconnect`，再调用 `connect`。

```ts type-equiv
/** Lifecycle state of a server that is still present in the runtime snapshot. */
type McpServerStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'disconnecting'
```

授权与普通 HTTP header 分开配置。凭据支持的 variant 会为每个 HTTP 请求解析其引用。`raw` 原样发送值，`bearer` 添加标准 `Bearer ` 前缀。替换凭据会影响下一次请求，但不会自行重连传输。

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

Stdio 直接执行命令，不经过 shell 插值。它的环境以 Provider 清除凭据后的父进程环境为起点，再仅加入明确配置的条目。Streamable HTTP 会拒绝嵌入 URL 的凭据、URL fragment、非 HTTP(S) scheme，以及 `headers` 中的字面量 `Authorization`。

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

连接器可以附加一个由 Host 持有的激活检查。Provider 会在发现完成但目录生效前调用指定的只读工具，再用同进程 classifier 处理已经分离并清除凭据的结果。每次重连 generation 都会重复此 gate。回调和结果都不会进入运行时快照。

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

## 目录与安全状态

Provider 会读取分页 `tools/list` 响应，组成一个完整目录。Task 支持与 MCP annotation 都保留为服务器提供的元数据；annotation 绝不授予执行权限。

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

每次提交生命周期或目录变更时，Provider 都会先递增 registry revision，再发出 `mcp/change`。快照只包含描述符和固定安全诊断，绝不包含传输客户端、header 或已解析凭据值。reconnecting 条目可以保留最近一次成功目录以保持 schema 稳定，但在服务器恢复 connected 前，调用会被拒绝；认证失败、恢复耗尽和 disconnecting 会清空目录。

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

## 调用与结果

调用会指定当前连接与原始服务器工具。Provider 会拒绝不存在、未连接或未声明的目标，传播取消并执行逐调用超时。规范结果保留无损 JSON 内容与可选结构化内容；Consumer 持有面向模型的纯文本投影。

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

## Provider 生命周期与 Consumer 批准

随产品交付的 Provider 提交 `connecting`，初始化全新传输 generation，发现完整工具列表，再提交 `connected` 或安全 `failed` 状态。已建立的连接关闭后会进入有界指数恢复。缺少凭据和认证被拒绝时会直接失败，不进行重试。断开时先发布带空目录的 `disconnecting`，关闭客户端与服务端支持的 HTTP session，等待目录同步和进行中的调用结束，再移除条目。如果服务器在结果中回显已知凭据值，这些值会被替换为 `[REDACTED]`。

腾讯文档连接器通过 raw 凭据引用提供已经签发的[空间 MCP Token](https://docs.qq.com/open/document/mcp/get-token/)，不负责登录、帐号选择或 Token 签发。金山文档使用供应商 CLI，个人 QQ 邮箱则使用 IMAP/SMTP 和授权码；两者都不属于这个 MCP seam，其生命周期与模型工具分别位于[金山文档](../../packages/host/kingsoft-docs-connector/README.md)和 [QQ 邮箱](../../packages/host/qq-mail-connector/README.md) Host 包。

每个 `tool-mcp` Consumer 都会把安全目录原子投影到一个 agent preset。公开名称是确定性的 `mcp__<serverName>__<rawName>` 身份；只有原始名称会发送到 `tools/call`。需要 task 的工具会在派发前失败，因为 task 执行尚未实现。

每个可执行 MCP 工具都会在执行器内部、紧邻 `ctx.mcp.callTool` 之前执行一次经过审计的[批准](approval.md)，因此更早的工具流水线 `allow` 无法绕过检查。只有 `allowed-once` 能到达传输层。缺少 approval 服务、调用缺少 agent 或任何非 grant 结果都会关闭式失败。远端 annotation 绝不是授权依据；未来若要豁免，必须使用单独审查且由 Host 持有的策略。

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

<a id="mcp-connectors-events"></a>

### `mcp-connectors/*` events

<a id="mcp-connectorschange--emit"></a>

#### `mcp-connectors/change` — emit

The public managed-MCP connector catalog changed.

```ts cordis-catalog
/**
 * The public managed-MCP connector catalog changed.
 * @mode emit
 * @param snapshot Current value-free catalog after the transition.
 */
'mcp-connectors/change'(snapshot: McpConnectorsPublicSnapshot): void
```

Types: [McpConnectorsPublicSnapshot](../../packages/host/mcp-connector/README.md)

Source: [`packages/host/mcp-connector/src/types.ts:149`](../../packages/host/mcp-connector/src/types.ts)

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
