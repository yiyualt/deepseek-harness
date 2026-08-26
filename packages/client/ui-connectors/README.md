# `@deepseek-ai/dsh-client-ui-connectors`

English | [中文](README.zh.md)

Web client plugin contributing the Connectors action to `sidebar.footer.action`. The modal contains independent Tencent Docs and Kingsoft Docs cards backed by the Host-owned `tencentDocsConnector` and `kingsoftDocsConnector` Remotes. The Tencent card renders lifecycle status, value-free credential metadata, discovered tool count, and a bounded failure. The Kingsoft card renders the credential-free browser-login lifecycle and tool count. The plugin subscribes to both public change events. Opening the panel reconciles missed state through each connector's loopback `get` or credential-free `publicGet` Remote. A newer push or completed mutation invalidates an older open refresh, and a completed connect or disconnect refuses its late transitional precursor; `updatedAt` is not treated as an ordering revision.

Tencent uses `TENCENT_DOCS_MCP_TOKEN`. On a loopback page, its controller learns only `configured`, `source`, and `writable` through `credentials.describe`; while the panel is open, a matching `credentials/updated` event starts an ordered read. A newly typed Token travels one way through `credentials.set` and is cleared from browser state before the Remote call. Disconnect stops Tencent before calling `credentials.unset`, and skips deletion when the winning source is read-only. Kingsoft has no Token field or credential API call: clicking Web login asks the Host to launch `kdocs-cli auth login`, and clicking Sign out asks the Host to remove the keychain login. The UI never receives either provider's stored credential. A non-loopback page is strictly view-only: it calls only each unprivileged `publicGet` Remote and never calls a credential method or `get`, `connect`, or `disconnect`.

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

- The panel contains two built-in document connectors and no dynamic connector catalog.
- Tencent authentication uses a manually obtained space MCP Token. Kingsoft browser authentication requires the official `kdocs-cli` to be installed on the Host.
- A non-loopback deployment requires a separate authenticated credential-management design before mutations can be enabled.
