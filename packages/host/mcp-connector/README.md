# `@deepseek-ai/dsh-host-mcp-connector`

English | [中文](README.zh.md)

Process-wide gateway and shared lifecycle for user-managed Streamable HTTP MCP connectors. The `connectors` configuration declares any number of Token-authenticated products: endpoint, credential reference, local server name, raw or Bearer authorization, and bilingual card metadata. The `mcpConnectors` Remote exposes one dynamic catalog through `list`, `publicList`, `connect(id)`, and `disconnect(id)`. Adding another compatible provider changes deployment configuration rather than adding another Remote namespace or browser component.

`McpConnectorLifecycle` owns serialized connect, retry, disconnect, credential refresh, runtime reconciliation, public state, and teardown for each configured entry. Connector ids, server names, and credential references must be unique. Endpoints and credential-help links must use HTTPS; invalid or duplicate configuration fails during plugin activation.

Credential values stay behind `ctx.credentials`. Connection requests contain only an opaque credential reference and either the `raw` or `bearer` authorization scheme. Complete snapshots contain credential availability, source, and writability but never the value. Public snapshots omit all credential metadata. Provider diagnostics are reduced to vendor-owned fixed failures before they reach either snapshot.

The full loopback catalog includes safe credential availability, source, writability, and the opaque credential reference needed by the existing write-only credential API. `publicList` and `mcp-connectors/change` omit every credential field. Presentation text and links are deployment-owned public metadata; neither catalog contains the endpoint, authorization scheme, or credential value.

## Model Experience

### Connector lifecycle

#### What the model sees

Nothing from this package. Vendor connectors request process-wide MCP connections, while the separate `dsh-tool-mcp` Consumer decides which agent presets receive their tools.

#### Token effect

This package adds no prompt or tool tokens. A connected server's catalog consumes tokens through the Consumer.

#### KV Cache effect

Lifecycle snapshots have no direct cache effect. Connecting or disconnecting can change the tool-schema prefix of later model requests.

## Known Limitations and Deferred Work

- The declarative catalog supports Token-authenticated Streamable HTTP MCP. OAuth redirects, refresh credentials, account selection, and local CLI integrations require separate adapters.
- Connection intent is memory-only and starts disconnected after every Host restart.
- OAuth, account selection, and Token issuance remain vendor-specific concerns.
