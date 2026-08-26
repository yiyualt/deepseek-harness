# `@deepseek-ai/dsh-host-mcp-connector`

English | [中文](README.zh.md)

Shared Host lifecycle for user-managed Streamable HTTP MCP connectors. A vendor package supplies a fixed endpoint, credential reference, local server name, authorization scheme, safe failure copy, and optional post-discovery verification call. `McpConnectorLifecycle` then owns serialized connect, retry, disconnect, credential-refresh, runtime-reconciliation, public-state, and teardown behavior without creating a Remote namespace of its own.

Credential values stay behind `ctx.credentials`. Connection requests contain only an opaque credential reference and either the `raw` or `bearer` authorization scheme. Complete snapshots contain credential availability, source, and writability but never the value. Public snapshots omit all credential metadata. Provider diagnostics are reduced to vendor-owned fixed failures before they reach either snapshot.

An optional connection check runs after MCP initialization and complete tool discovery but before the runtime publishes `connected`. The vendor chooses one read-only tool, fixed JSON arguments, a timeout, and a result classifier. Only `accepted` activates the discovered catalog. Authentication rejection or an unusable response closes the initializing transport before publishing a failure, and reconnect generations repeat the same check.

## Model Experience

### Connector lifecycle

#### What the model sees

Nothing from this package. Vendor connectors request process-wide MCP connections, while the separate `dsh-tool-mcp` Consumer decides which agent presets receive their tools.

#### Token effect

This package adds no prompt or tool tokens. A connected server's catalog consumes tokens through the Consumer.

#### KV Cache effect

Lifecycle snapshots have no direct cache effect. Connecting or disconnecting can change the tool-schema prefix of later model requests.

## Known Limitations and Deferred Work

- One lifecycle instance owns one fixed endpoint, server name, and credential reference.
- Connection intent is memory-only and starts disconnected after every Host restart.
- OAuth, account selection, and Token issuance remain vendor-specific concerns.
