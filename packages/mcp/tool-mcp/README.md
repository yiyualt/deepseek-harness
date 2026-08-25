# @deepseek-ai/dsh-tool-mcp

English | [中文](README.zh.md)

`dsh-tool-mcp` is the Consumer for `ctx.mcp`. Mounted in an agent preset scope, it keeps that scope's `ctx.tools` registrations synchronized with the dynamic MCP catalog without exposing transport clients to tool definitions.

## Usage

Mount the consumer inside the preset that should receive connected tools:

```yaml
- id: tool-mcp
  name: '@deepseek-ai/dsh-tool-mcp'
  config:
    toolCallTimeoutMs: 60000
```

It reads the current snapshot at activation and listens for `mcp/change`. Each tool is registered as `mcp__<serverName>__<rawName>`. Names that require character replacement or truncation receive a deterministic hash suffix, so two MCP identities do not collapse into one public name.

A catalog update is prepared and validated before the prior generation is removed. Unsupported input schemas leave the prior generation intact. A registration collision rolls back every registration attempted for the new generation, so the scope never receives a partial MCP catalog. The runtime may retain a last-good catalog while a server is `reconnecting`; those schemas remain visible, but calls fail until the connection recovers. Disposing the preset removes all registrations.

## Execution and policy

Tool definitions retain only the opaque server name and raw tool name. For every executable MCP call, the executor requests one audited approval immediately before `ctx.mcp.callTool(...)`; an earlier tool-pipeline decision cannot bypass this last-mile check. Only `allowed-once` proceeds. A missing approval service, a call without an agent, or an outcome of `rejected`, `cancelled`, or `unavailable` fails before transport dispatch.

The approval request identifies the public tool name and call id, carries the caller's abort signal, and uses `MCP tool may change external data` as its reason. MCP annotations are untrusted statements supplied by the remote server, so even `readOnlyHint: true` cannot grant execution authority.

Task-required MCP tools are visible but fail before transport dispatch because this Consumer does not implement task-based execution.

## Result projection

The canonical value preserves all MCP JSON content blocks plus optional structured content. Native rendering joins text blocks and replaces image, audio, resource, and unknown blocks with compact placeholders, so binary or resource payloads do not enter model context. A server `isError` result enters the normal tool failure path.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.mcp` | Observe safe catalogs and invoke the current server generation |
| `ctx.tools` | Register scoped tools and guard their execution |
| `ctx.approval` | Grant one executable call immediately before transport dispatch; absence fails closed |

## Model Experience

### Connected MCP tools

#### What the model sees

Each last-good descriptor appears as one scoped tool named `mcp__<serverName>__<rawName>` (or its deterministic normalized form), with the server description and input schema. Catalog removal or preset disposal removes it. Every MCP call requires user approval before dispatch; a retained reconnecting catalog may be visible while calls temporarily fail.

#### Token effect

Every visible descriptor adds its name, description, and schema to each request until the catalog or scope changes. Tool arguments and rendered results remain in session history until compaction.

#### KV Cache effect

Prefix-stable while the scoped catalog is unchanged. Adding, removing, or changing a descriptor can invalidate reuse from the first changed tool-schema token; later tool calls and results append after the reusable prefix.

## Known Limitations and Deferred Work

- Only MCP tools are projected; MCP resources and prompts are not model-facing here.
- MCP task-required execution is not implemented.
- Native rendering is text-only and intentionally discards non-text payloads after preserving them in the execution-local canonical value.
- Safety annotations are untrusted server assertions retained for information only. Every executable MCP call passes the executor-owned last-mile approval; a future no-confirmation path requires a separate Host-owned reviewed policy.
