# `@deepseek-ai/dsh-client-ui-connectors`

English | [中文](README.zh.md)

Web client plugin contributing the Connectors action to `sidebar.footer.action`. The modal renders every Token-authenticated hosted MCP product returned by the Host-owned `mcpConnectors` catalog, followed by the independent Kingsoft Docs CLI card. Product names, descriptions, credential labels, setup links, lifecycle state, and tool counts come from the generic catalog; adding another configured MCP product does not add a browser component. The Kingsoft card remains backed by `kingsoftDocsConnector` because browser login and CLI execution are not MCP transport behavior.

On a loopback page, the managed MCP controller receives only each provider's opaque credential reference and safe `configured`, `source`, and `writable` metadata. A newly typed value travels one way through `credentials.set` and is cleared from browser state before `connect(id)`. Disconnect stops the selected MCP connection before calling `credentials.unset`, and skips deletion when the active source is read-only. Kingsoft has no Token field or credential API call: Web login launches `kdocs-cli auth login`, and Sign out removes the keychain login. A non-loopback page calls only `mcpConnectors.publicList` and `kingsoftDocsConnector.publicGet` and cannot mutate credentials or connections.

Stable connector failure codes select localized Chinese or English copy; a Host `errorMessage` is displayed only for an unknown code. If a connector RPC fails and its matching `connecting` or `disconnecting` state arrives before or after that carrier failure, the controller commits a local retryable `CLIENT_REQUEST_FAILED` state so the panel cannot remain busy indefinitely. A request with no matching transition preserves the last Host terminal state and reports the local carrier error separately; a later non-matching Host state clears that pending association.

## Model Experience

### Connector management

#### What the model sees

Nothing from this UI package itself. Tencent's Host MCP integration and Kingsoft's scoped CLI Consumer own the tools added to later model requests, including `kingsoft_docs_help` and `kingsoft_docs_call`.

#### Token effect

The panel adds no tokens. Tool schemas exposed by the connected Host integration consume model-request tokens separately.

#### KV Cache effect

Opening and closing the panel has no effect. Connecting or disconnecting can change the Host's tool roster and therefore the cacheable request prefix.

## Known Limitations and Deferred Work

- Hosted MCP cards currently support manually obtained raw or Bearer Tokens. OAuth-based providers need a separate authorization adapter.
- Kingsoft browser authentication requires the official `kdocs-cli` to be installed on the Host.
- A non-loopback deployment requires a separate authenticated credential-management design before mutations can be enabled.
