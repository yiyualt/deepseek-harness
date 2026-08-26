# `@deepseek-ai/dsh-client-ui-connectors`

English | [中文](README.zh.md)

Web client plugin contributing the Connectors action to `sidebar.footer.action`. The modal renders every Token-authenticated hosted MCP product returned by the Host-owned `mcpConnectors` catalog, followed by independent Kingsoft Docs and personal QQ Mail cards. Product names, descriptions, credential labels, setup links, lifecycle state, and tool counts come from the generic MCP catalog; adding another configured MCP product does not add a browser component. Kingsoft remains a CLI adapter, while personal QQ Mail uses provider-specific IMAP/SMTP credentials.

On a loopback page, the managed MCP controller receives only each provider's opaque credential reference and safe `configured`, `source`, and `writable` metadata. A newly typed value travels one way through `credentials.set` and is cleared from browser state before `connect(id)`. Disconnect stops the selected connection before calling `credentials.unset`, and skips deletion when the active source is read-only. The Kingsoft card starts `kdocs-cli auth login`. The QQ Mail card stores an `@qq.com` address and IMAP/SMTP authorization code through the same one-way credential API; the authorization code is not a QQ password. A non-loopback page calls only safe public state methods and cannot mutate credentials or connections.

Stable connector failure codes select localized Chinese or English copy; a Host `errorMessage` is displayed only for an unknown code. If a connector RPC fails and its matching `connecting` or `disconnecting` state arrives before or after that carrier failure, the controller commits a local retryable `CLIENT_REQUEST_FAILED` state so the panel cannot remain busy indefinitely. A request with no matching transition preserves the last Host terminal state and reports the local carrier error separately; a later non-matching Host state clears that pending association.

## Model Experience

### Connector management

#### What the model sees

Nothing from this UI package itself. The Host MCP integration and provider-specific Consumers own the tools added to later model requests, including `kingsoft_docs_*` and `qq_mail_*`.

#### Token effect

The panel adds no tokens. Tool schemas exposed by the connected Host integration consume model-request tokens separately.

#### KV Cache effect

Opening and closing the panel has no effect. Connecting or disconnecting can change the Host's tool roster and therefore the cacheable request prefix.

## Known Limitations and Deferred Work

- Hosted MCP cards currently support manually obtained raw or Bearer Tokens. OAuth-based providers need a separate authorization adapter.
- Kingsoft browser authentication requires the official `kdocs-cli` to be installed on the Host.
- Personal QQ Mail requires IMAP/SMTP to be enabled and an authorization code generated in QQ Mail settings.
- A non-loopback deployment requires a separate authenticated credential-management design before mutations can be enabled.
