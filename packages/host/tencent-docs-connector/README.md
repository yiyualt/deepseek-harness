# `@deepseek-ai/dsh-host-tencent-docs-connector`

English | [中文](README.zh.md)

Web Host service for one process-wide Tencent Docs MCP connection. The `tencentDocsConnector` Remote turns an explicit user gesture into a connection to the fixed Streamable HTTP endpoint `https://docs.qq.com/openapi/mcp`, projects safe state through `tencent-docs-connector/change`, and delegates transport ownership to `ctx.mcp`.

The service starts `disconnected` even when a [space MCP Token](https://docs.qq.com/open/document/mcp/get-token/) is already configured. Tencent binds that Token to the space selected during issuance. The service never connects until the user calls `connect`. A successful call first confirms that `TENCENT_DOCS_MCP_TOKEN` resolves, removes any prior `tencent_docs` MCP entry, and passes this authorization descriptor to `ctx.mcp`:

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { McpCredentialAuthorizationConfig } from '@deepseek-ai/dsh-mcp'

const authorization: McpCredentialAuthorizationConfig = {
  kind: 'credential',
  ref: credentialRef('TENCENT_DOCS_MCP_TOKEN'),
  scheme: 'raw',
}
```

The MCP provider resolves that reference for every HTTP request and sends its value verbatim as the `Authorization` header; it does not prepend `Bearer `. The connector never accepts or returns a Token as a Remote value, caches one, or includes one in a snapshot or diagnostic. The Web client stores and removes the value separately through the loopback credential API.

`connect` settles as `connected` only after the MCP provider completes initialization and obtains `tools/list`; `toolCount` is therefore the usable catalog size. A duplicate or failed runtime entry is explicitly disconnected before a retry because `ctx.mcp.connect` never replaces a live name. `disconnect` waits until the transport generation and its owned work are quiescent. Plugin teardown performs the same awaited disconnect.

## Remote API

| Method | Input | Result |
|---|---|---|
| `get` | none | Complete current snapshot after refreshing credential metadata. |
| `publicGet` | none | Credential-free current snapshot without reading credential metadata. |
| `connect` | none | Complete settled snapshot after an explicit connection attempt. |
| `disconnect` | none | Complete settled snapshot after an awaited disconnection. |

The loopback-pinned `get`, `connect`, and `disconnect` methods return the complete snapshot directly. `get` is the read path for credential metadata: the complete value contains `credentialConfigured`, `credentialSource`, and `credentialWritable` in addition to `status`, `toolCount`, safe `errorCode` and `errorMessage` fields, and `updatedAt`; it contains no credential value. `connect` and `disconnect` return the same complete value after their mutation settles.

Trusted non-loopback clients can call `publicGet` and receive the same value-free fields carried by the public `tencent-docs-connector/change` event: `status`, `toolCount`, safe failure fields, and `updatedAt`. Neither path reads or exposes credential configuration, source, writability, or value.

Statuses are `disconnected`, `connecting`, `connected`, `reconnecting`, `disconnecting`, and `failed`. Credential and MCP events refresh the projection. The provider resolves a rotated credential on the next HTTP request; the connector neither creates a second transport nor caches the previous header.

Stable connector failures include `CREDENTIAL_MISSING`, `CREDENTIAL_LOOKUP_FAILED`, `AUTH_REJECTED`, `CONNECTION_FAILED`, `CONNECTION_LOST`, and `DISCONNECT_FAILED`. Every `errorMessage` is a fixed English fallback; clients localize with `errorCode`. HTTP 401-style MCP failures map to fixed `AUTH_REJECTED` copy, so provider diagnostics cannot echo an authorization value to the browser.

## Model Experience

### Connected Tencent Docs tools

#### What the model sees

After connection, the assembled MCP consumer makes `mcp__tencent_docs__<rawName>` tools visible to the model; this package contributes no tool schema, prompt text, or session event of its own.

#### Token effect

The connected server's tool names, descriptions, and JSON Schemas consume request tokens. The exact amount is controlled by the catalog returned by Tencent Docs; disconnected connector state adds none.

#### KV Cache effect

Connecting, reconnecting, or disconnecting may change the tool-schema prefix of the next model request. Repeated connector snapshots do not enter model context.

## Known Limitations and Deferred Work

- This package connects an already-issued space MCP Token; it does not implement Tencent login, OAuth, consent, Token issuance, or permission selection.
- The endpoint, credential reference, and MCP server name are fixed. Multiple Tencent Docs accounts and per-workspace connections remain deferred.
- Connection intent is not persisted across Host restarts. A configured Token remains stored by the credential provider, but the user must click Connect again.
- Available read and write operations, their authorization requirements, and their confirmation semantics come from the Tencent Docs MCP server and the assembled MCP Tool consumer, not this lifecycle Remote.
