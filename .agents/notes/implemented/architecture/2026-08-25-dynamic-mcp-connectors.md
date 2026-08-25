# Agent Note: Dynamic MCP connectors separate Host connections from preset tools

Status: implemented

English | [中文](2026-08-25-dynamic-mcp-connectors.zh.md)

## Problem

The package-root [MCP client bridge](../feature/2026-07-07-mcp-client-plugin.md) owns one server configured at composition time and registers that server's tools directly in its Cordis scope. A product Connectors panel needs different ownership: a user can connect or disconnect an external account while the Host stays running, credentials must remain outside browser and model data, and each Agent Preset must decide whether its agents receive the resulting tools.

Putting Remote methods, credential storage, transport clients, and model-facing tools in one connector plugin would make account UI dictate the MCP runtime interface. It would also make a process-wide connection implicitly expand every agent's tool set, including intentionally small presets.

## Decision

Dynamic MCP integration is a capability seam with three independent roles:

- [`@deepseek-ai/dsh-mcp`](../../../../packages/mcp/mcp/README.md) is the Service Definition. `ctx.mcp` owns named connection requests, complete safe snapshots, catalog-change events, disconnect quiescence, and raw-name tool calls without exposing an SDK client.
- [`@deepseek-ai/dsh-mcp-client/runtime`](../../../../packages/mcp/mcp-client/README.md#entry-points) is the Host Service Provider. One base-bundle instance owns transport generations, credential resolution, discovery, recovery, and teardown for all dynamic servers.
- [`@deepseek-ai/dsh-tool-mcp`](../../../../packages/mcp/tool-mcp/README.md) is the Consumer. Each mounted Agent Preset projects the current catalog into that preset's `ctx.tools` registry and resolves calls through the runtime's current generation.

The package-root `@deepseek-ai/dsh-mcp-client` remains the static one-server bridge. Its direct `ctx.tools` registrations and [bounded reconnect supervisor](../feature/2026-08-06-mcp-client-auto-reconnect.md) retain their existing composition contract; dynamic connectors use the separate `./runtime` entry.

### Host and preset ownership

The base bundle mounts the dynamic runtime because connection health, credentials, and transport cleanup are process-wide Host concerns. The `standard`, `code`, and `cordis` presets mount the MCP Tool Consumer. The `minimal` preset omits it, so a connected account does not change that preset's model-facing tool set.

A product-specific Host connector translates explicit user intent into one fixed MCP connection and exposes only value-free state through its Remote API. The browser uses the existing loopback-only credential API to write a secret, then calls a no-argument connector method. Remote arguments, snapshots, pushed events, and diagnostics never carry the secret. A non-loopback browser can inspect connector state but cannot mutate credentials or connection state.

Connections start disconnected even when a credential exists. The user must explicitly connect after each Host start. Disconnect waits for the runtime generation and in-flight work to settle; a writable active credential source can then be removed by the browser, while an environment-backed credential remains outside browser control.

### Tencent Docs space MCP Token connector

The first connector reserves the `tencent_docs` server name and the `TENCENT_DOCS_MCP_TOKEN` credential reference for `https://docs.qq.com/openapi/mcp`. Tencent's [official Token tutorial](https://docs.qq.com/open/document/mcp/get-token/) issues an MCP Token bound to the space selected during issuance. This space MCP Token MVP accepts that already-issued value; Tencent login, OAuth, consent, Token issuance, permission selection, multiple accounts, and space selection remain outside this connector.

Tencent's space MCP Token is a raw HTTP `Authorization` value. The runtime resolves its credential reference for every HTTP request and sends the value verbatim without adding `Bearer `. Literal authorization headers are rejected. Safe snapshots contain only status, catalog descriptors, fixed error codes, and fixed messages; resolved secret values are also redacted if a server echoes them in tool results.

### Tool identity and approval

The Consumer preserves the established `mcp__<serverName>__<rawName>` public-name contract and calls the raw tool name through `ctx.mcp`. Catalog replacement is atomic within each preset scope; an invalid schema or registration conflict cannot publish a partial generation.

Remote annotations are untrusted server input and never reduce approval. For every executable MCP tool, the Consumer requests approval inside the executor immediately before `ctx.mcp.callTool`, using `MCP tool may change external data` as the reason; this last-mile placement cannot be bypassed by an earlier tool-pipeline decision. Only `allowed-once` reaches the transport. A missing approval service, a call without an agent, and every non-grant outcome fail closed. A future confirmation exemption requires a Host-owned, reviewed allowlist or policy keyed independently of remote annotations; server metadata alone can never grant it.

## Alternatives considered

**Extend the static package-root bridge with product Remotes and UI state.** Rejected: the static plugin intentionally combines one configured transport with direct tool registration. Dynamic account lifecycle and preset-specific visibility need separate owners and independently testable failure behavior.

**Register every connected tool globally from the Host provider.** Rejected: transport ownership is process-wide, but tool visibility is an Agent Preset decision. Global registration would let one UI action widen unrelated and minimal agents.

**Pass the Token to a connector Remote method.** Rejected: RPC arguments are observable application data and would widen the secret's lifetime and exposure. The credential service already provides a loopback-only write path and opaque references for runtime consumers.

**Auto-connect whenever a stored Token exists.** Rejected: a credential proves availability, not current user intent to contact an external service or expose its catalog. Explicit connection also makes restart behavior and failure recovery visible.

**Implement Tencent OAuth before exposing the connector.** Deferred: the space MCP Token supplies the minimum credential needed to validate the MCP product path. OAuth adds browser redirects, consent, refresh, revocation, and account selection as a separate authorization decision.

**Use remote `readOnlyHint` annotations to bypass confirmation.** Rejected: the remote server controls every annotation and can misstate or change it together with the tool implementation. All executable MCP tools use the same executor-owned approval path; any future exemption comes from a separately reviewed Host policy.

**Request confirmation only through `tools/pre-execute`.** Rejected: an earlier listener can return `allow` and short-circuit later policy listeners. Approval belongs in the MCP executor immediately before the external call, where every execution path must pass it.

## Verification

The Service Definition and Consumer suites pin snapshot revisioning, scoped catalog replacement, name stability, current-generation dispatch, disposal, executor-owned approval for true, false, and missing remote safety annotations, early-allow resistance, and fail-closed missing-service, missing-agent, rejection, cancellation, and unavailable outcomes. The provider's keyless Streamable HTTP integration covers raw authorization, paginated discovery, credential rotation on a later request, echoed-secret redaction, safe authentication failure, and disconnect. Host and browser controller tests pin the no-secret Remote interface, explicit connection, loopback mutation fence, writable-source deletion, and read-only remote view.

## Consequences

- Adding another product connector requires a Host adapter and UI contribution, not another MCP protocol implementation or another tool registry path.
- A connected catalog changes model tool schemas only in presets that mount the Consumer. Tool names, descriptions, and JSON Schemas add request tokens and may invalidate KV-cache reuse from the first changed schema token.
- The Host can rotate or revoke credentials without publishing their values. A changed raw credential is resolved on the next HTTP request; the connector does not cache an authorization header.
- Read-only MCP operations still require executor-owned last-mile approval. Removing that friction requires a reviewed Host policy and cannot reuse server-controlled annotations as authority.
- The space MCP Token MVP leaves Tencent OAuth and multi-account identity unresolved by design. Supporting them adds new credential and connector states rather than weakening raw-Token semantics.
- MCP resources, prompts, and task-required execution remain outside the Tool Consumer.
