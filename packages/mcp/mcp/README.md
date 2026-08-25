# @deepseek-ai/dsh-mcp

English | [中文](README.zh.md)

`dsh-mcp` is the Service Definition for dynamic Model Context Protocol connections. It adds `ctx.mcp`; transport providers implement connection generations, credential resolution, reconnection, catalog discovery, and teardown, while consumers read only safe snapshots and call raw tool names through the runtime.

## API

| Method | Purpose |
|---|---|
| `connect({ serverName, transport })` | Start one named connection and settle after its initial state is committed |
| `disconnect(serverName)` | Withdraw its catalog, stop owned work, await transport quiescence, and remove it from the snapshot |
| `snapshot()` | Return the complete safe registry revision and server catalog |
| `callTool({ serverName, name, args, signal, timeoutMs })` | Call a raw tool on the current transport generation |

Create names with `mcpServerName(value)`. They accept one to 32 ASCII letters, digits, `_`, or `-` and are opaque outside this package.

`connect` rejects a name that is still present in `snapshot().servers`, including a connected, failed, or disconnecting entry. Replacing a configuration or retrying a failed connection is an explicit `await disconnect(name)` followed by `connect(...)`. Disconnecting an unknown name is a no-op.

## Transport and credentials

The transport union currently supports child-process stdio and Streamable HTTP. HTTP authorization is separate from ordinary headers:

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { McpStreamableHttpTransportConfig } from '@deepseek-ai/dsh-mcp'

const transport: McpStreamableHttpTransportConfig = {
  kind: 'streamable-http',
  url: 'https://example.test/mcp',
  authorization: {
    kind: 'credential',
    ref: credentialRef('EXAMPLE_MCP_TOKEN'),
    scheme: 'raw',
  },
}
```

`scheme: 'raw'` sends the resolved credential verbatim as the `Authorization` value; it does not prepend `Bearer `. The shipped runtime resolves the reference for every HTTP request, so a replaced credential is observed by the next request without reconnecting the active transport; credential replacement does not itself trigger a reconnect. Providers reject an `Authorization` key in `headers`, and snapshots and diagnostics never include transport headers or resolved credential values.

## Snapshots and events

Every server snapshot has a status (`connecting`, `connected`, `reconnecting`, `failed`, or `disconnecting`), a transport generation, its last successfully advertised tool descriptors, and optional safe `errorCode` and `errorMessage`. A transient `reconnecting` state may retain that last-good catalog for schema stability, but `callTool` rejects until the server returns to `connected`. Authentication failure, exhausted recovery, and `disconnecting` clear the catalog. A finished disconnect removes the server instead of retaining a `disconnected` tombstone.

Providers commit state before calling the protected `notifyChange()`. It emits the full current snapshot through unfiltered `mcp/change`; ordinary listener failures are contained and logged, while synchronous invariant failures still surface after every listener has run.

Tool descriptors retain input and output schemas, task support, and the four standard MCP safety hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. These hints are untrusted server statements for information and audit; they do not grant execution authority.

## Model Experience

### MCP connection state

#### What the model sees

Nothing from this Service Definition directly. A consumer such as `@deepseek-ai/dsh-tool-mcp` decides which catalog entries become model-facing tools and how results are rendered.

#### Token effect

None until a consumer projects descriptors or results into a model request.

#### KV Cache effect

None from the runtime snapshot or lifecycle event alone.

## Known Limitations and Deferred Work

- This package defines the runtime interface but does not provide a transport implementation.
- The catalog covers MCP tools only; resources and prompts need separate consumers before they belong in this seam.
- Authorization currently has only credential-backed raw HTTP values. OAuth and additional schemes require new discriminants rather than changing `raw` semantics.
