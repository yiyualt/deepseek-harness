# @deepseek-ai/dsh-mcp-client

English | [中文](README.zh.md)

MCP client transports for external [Model Context Protocol](https://modelcontextprotocol.io/) servers. The package root is a static, one-server bridge that registers directly on `ctx.tools`; `@deepseek-ai/dsh-mcp-client/runtime` is the Host-owned provider for dynamic `ctx.mcp` connections and publishes only safe catalogs for preset-scoped consumers.

## Entry points

| Entry point | Ownership | Tool visibility |
|---|---|---|
| Package root | One Cordis plugin instance owns one configured server and its `ctx.tools` registrations. | Global to that plugin's scope. |
| `./runtime` | One Host service owns every dynamic transport generation and implements [`ctx.mcp`](../mcp/README.md). | None directly; [`dsh-tool-mcp`](../tool-mcp/README.md) projects catalogs inside selected agent presets. |

## Usage

One plugin instance per MCP server in `cordis.yml`:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

The model sees `mcp__github__create_issue`, `mcp__web__search`, … — the same server-qualified shape Claude Code and Codex use. HMR hot-swaps: editing the entry triggers disconnect + reconnect without process restart; an unchanged `serverName` reproduces identical tool names.

## Config

The following fields configure the static package-root bridge:

| Field | Transport | Required | Description |
|---|---|---|---|
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `serverName` | both | yes | Namespace for this server's model-facing tool names; `[A-Za-z0-9_-]{1,32}`, unique across live instances |
| `command` | stdio | yes | Executable to spawn |
| `args` | stdio | no | Arguments passed to the command |
| `env` | stdio | no | Extra env vars merged on top of scrubbed ambient env |
| `cwd` | stdio | no | Working directory for the child process |
| `url` | http | yes | MCP server URL |
| `headers` | http | no | Extra headers (e.g. auth tokens) |
| `toolCallTimeoutMs` | both | no | Timeout per `callTool` invocation (default 60000) |
| `failOnStartupError` | both | no | Reject plugin activation when initial connection or tool synchronization fails (default `false`) |
| `reconnect.enabled` | both | no | Reconnect automatically after a lost connection (default `true`) |
| `reconnect.initialDelayMs` | both | no | First reconnect delay in ms; doubles per consecutive failed attempt (default 500) |
| `reconnect.maxDelayMs` | both | no | Backoff ceiling in ms; also the uptime after which the attempt budget resets (default 30000) |
| `reconnect.maxAttempts` | both | no | Consecutive failed attempts per outage before giving up for good (default 10) |

The dynamic `./runtime` entry accepts only lifecycle budgets: `connectTimeoutMs` (default 30000), `reconnectInitialDelayMs` (500), `reconnectMaxDelayMs` (30000), and `reconnectMaxAttempts` (10). `connectTimeoutMs` bounds each initialize attempt, each complete paginated `tools/list` discovery, and best-effort HTTP session termination. Individual connections arrive through `ctx.mcp.connect(...)`; they are not Cordis config rows.

## Dynamic runtime credentials and lifecycle

Streamable HTTP authorization uses a credential reference, never a literal `Authorization` header. The runtime resolves the reference for every HTTP request; `scheme: 'raw'` sends the value verbatim, while `scheme: 'bearer'` prepends `Bearer `. Literal `Authorization` entries in `headers`, URL credentials, non-HTTP(S) URLs, and URL fragments are rejected before connection.

Snapshots, events, and diagnostics contain no transport headers or credential values. Every non-empty explicit stdio env or HTTP header value and every credential value resolved during a connection remain in its redaction history until disconnect, so old in-flight responses stay covered after credential rotation. The runtime recursively replaces those values in tool catalogs and results with `[REDACTED]`; a catalog generation fails with a safe error if redaction would change a tool name or task-support enum. Stdio children receive the scrubbed parent environment plus explicit connection env values.

`connect` reserves the server name, initializes one transport generation, and drains at most 100 `tools/list` pages without accepting a repeated cursor. If the request includes an activation check, the runtime calls its advertised read-only tool and classifies the detached result before it commits `connected`; each recovery generation repeats the same gate. A failed name is not replaced implicitly: callers disconnect it before retrying. `notifications/tools/list_changed` refreshes the catalog; a failed refresh keeps the current tools and records a safe error. An established transport close starts bounded exponential recovery, while authentication rejection and missing credentials fail without retrying. `disconnect` removes the catalog, attempts bounded HTTP session termination, closes every established or initializing client, and waits for connection, catalog, activation, and tool-call work before removing the server snapshot.

## Tool naming

Every MCP tool has two names: the raw MCP name (sent on the wire in `tools/call`) and the public name `mcp__<serverName>__<rawName>` registered on `ctx.tools`. Public names are normalized to the DeepSeek function-name contract (64 chars, `[A-Za-z0-9_-]`); when replacement or truncation changes the name, a deterministic 12-hex-char hash of `(serverName, rawName)` is appended so distinct tools never collapse into one name. Names are pure functions of `(serverName, rawName)` — connection order, re-syncs, and other servers never rename a tool.

- Two servers publishing the same raw name (e.g. `search`) coexist under their namespaces.
- A duplicate `serverName` across live instances fails the later plugin instance at load.
- A server listing the same tool name twice is rejected as an invalid tool list.
- A foreign registration squatting on this server's namespace rolls back the whole generation (never a partial set), with a loud error.

## Behavior

- On connect: plugin activation awaits `listTools()` and registers each tool via `ctx.tools.register()` under its public name before the composition starts its first turn. Initial connection, discovery, or registration failure is always logged; it rejects activation when `failOnStartupError` is true and otherwise activates with no tools.
- Listens for `notifications/tools/list_changed` → re-syncs; a fetch-phase failure keeps the previous generation registered, while a registration conflict rolls back the attempted generation and leaves no tools from that server.
- Tool execute: `client.callTool({ name: rawName, arguments }, { signal })` with timeout + abort support—the public name is never sent to the server.
- Canonical success is `{ content: JsonValue[], structuredContent? }`; complete JSON MCP blocks survive for programmatic callers. A supported advertised `outputSchema` validates `structuredContent`; unsupported schema vocabulary falls back to unconstrained `JsonValue`.
- Native/model rendering keeps the existing text projection: text blocks join with newlines while image, audio, resource, and unsupported blocks become placeholders.
- On disconnect/crash: the supervisor restarts the original server config with exponential backoff (`reconnect.initialDelayMs` doubling up to `reconnect.maxDelayMs`) and re-runs discovery on success — the recovered generation replaces the previous one, so tools neither duplicate nor leak. During the outage the last good generation stays registered; calls against it fail until recovery.
- Reconnection is budgeted per outage: after `reconnect.maxAttempts` consecutive failures the server's tools are unregistered and reconnection stops until an HMR reload or Host restart. A connection that survives past `maxDelayMs` resets the budget, so an occasionally-crashing server recovers indefinitely while a crash-looping one — even with briefly successful connects — still exhausts the cap instead of restarting forever.
- Reconnect states are user-visible in logs: reconnecting (warn, with attempt count and delay), recovered (info), final failure and disabled-loss (error). Disposal cancels any pending reconnect. With `reconnect.enabled: false`, a lost connection keeps tools registered but failing until a reload — the manual-recovery behavior.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.tools` | Static package root: register/unregister MCP tools. |
| `ctx.credentials` | Dynamic runtime: resolve credential references without publishing values. |

The dynamic runtime provides `ctx.mcp`; it does not consume `ctx.tools`.

## Model Experience

### Discovered MCP tools

#### What the model sees

After initial discovery succeeds, each advertised MCP tool appears as a native tool named `mcp__<serverName>__<rawName>` (or its deterministic normalized form), with the server-provided description and input schema. A successful re-sync — including the one after an automatic reconnect — replaces the generation; plugin disposal or an exhausted reconnect budget removes it.

#### Token effect

Data-dependent schema cost is paid on every request while the tools are registered. Re-sync replaces rather than accumulates schemas, and the server-qualified name adds tokens to every tool definition and call.

#### KV Cache effect

Prefix-stable while the discovered tool set and schemas are unchanged. A re-sync that adds, removes, renames, or changes a tool replaces definitions and may invalidate reuse from the first changed schema token; a reconnect that recovers an unchanged list reproduces identical definitions and stays prefix-stable.

### Tool-call history and results

#### What the model sees

The public tool name and JSON arguments remain in assistant history. Text result blocks are joined with newlines into one retained Native text result; image, audio, resource, and unsupported blocks become short placeholders there. Their full JSON blocks and optional structured content remain in the execution-local canonical value, and MCP `isError` rejects the call through the registry's error path.

#### Token effect

Arguments and mapped text are retained until compaction. Binary and resource payloads are discarded rather than added to context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Dynamic runtime state

#### What the model sees

Nothing directly. `ctx.mcp` snapshots and lifecycle events remain Host state; a preset-scoped consumer decides which descriptors and results enter a model request.

#### Token effect

None until a consumer projects a connected catalog or tool result.

#### KV Cache effect

None from runtime state alone.

## Known Limitations and Deferred Work

- **Tools are the only bridged MCP capability** — Resources and Prompts have no harness consumer and are deferred.
- **The two entry points have separate composition contracts** — the package root remains the static bridge documented above; `./runtime` requires the `dsh-mcp` Service Definition and a separate Consumer before any dynamic catalog is model-visible.
- **Dynamic HTTP authorization supports credential-backed raw and Bearer values** — OAuth requires a separate authorization lifecycle.
- **Reconnect triggers on transport close** — a crashed stdio child fires it; Streamable HTTP failures surface per request and through the SDK transport's own SSE-stream recovery, so an unreachable HTTP server is retried per call rather than respawned by the supervisor.
- **Native non-text rendering is lossy** — image, audio, and resource payloads become placeholders in model context even though the execution-local canonical value preserves their JSON blocks. Richer Native multimedia projection is deferred.
- **Unsupported MCP output schemas are not enforced** — `structuredContent` falls back to `JsonValue` when the advertised schema uses vocabulary outside the harness subset.
