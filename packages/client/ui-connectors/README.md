# `@deepseek-ai/dsh-client-ui-connectors`

English | [中文](README.zh.md)

Web client plugin contributing the Connectors action to `sidebar.footer.action`. The action opens a modal whose first card manages the Tencent Docs MCP connector through the Host-owned `tencentDocsConnector` Remote. On loopback pages, the card renders the complete Remote snapshot, including lifecycle status, credential metadata, discovered tool count, and a bounded failure message. It subscribes to the value-free `tencent-docs-connector/change` event and merges those public lifecycle fields without erasing locally known credential metadata. Opening the panel reconciles missed state through the complete loopback `get` or credential-free `publicGet` Remote. A newer push or completed mutation invalidates an older open refresh, and a completed connect or disconnect refuses its late transitional precursor; `updatedAt` is not treated as an ordering revision.

The Space MCP Token uses the fixed `TENCENT_DOCS_MCP_TOKEN` credential reference. On a loopback page, the controller learns only `configured`, `source`, and `writable` through `credentials.describe`; while the panel is open, a forwarded `credentials/updated` event for that exact reference starts a new ordered read, and only the newest read can update the card. A newly typed Token travels one way through `credentials.set` and is cleared from browser state before the connector Remote is called. Disconnect stops the connector before calling `credentials.unset`, and skips that deletion when the winning credential source is read-only. The UI never receives a stored Token. A closed panel does not re-read on credential invalidations. A non-loopback page is strictly view-only: it calls only the unprivileged `publicGet` Remote to fetch the safe current snapshot, does not subscribe to credential invalidations, and never calls a credential method or `get`, `connect`, or `disconnect`.

Stable connector failure codes select localized Chinese or English copy; a Host `errorMessage` is displayed only for an unknown code. If a connector RPC fails and its matching `connecting` or `disconnecting` state arrives before or after that carrier failure, the controller commits a local retryable `CLIENT_REQUEST_FAILED` state so the panel cannot remain busy indefinitely. A request with no matching transition preserves the last Host terminal state and reports the local carrier error separately; a later non-matching Host state clears that pending association.

## Model Experience

### Connector management

#### What the model sees

Nothing from this UI package itself. After `tencentDocsConnector.connect` succeeds, the Host MCP integration can add the connector's discovered tools to later model requests.

#### Token effect

The panel adds no tokens. Tool schemas exposed by the connected Host integration consume model-request tokens separately.

#### KV Cache effect

Opening and closing the panel has no effect. Connecting or disconnecting can change the Host's tool roster and therefore the cacheable request prefix.

## Known Limitations and Deferred Work

- The panel contains one Tencent Docs card and no connector catalog.
- Authentication is limited to a manually obtained Space MCP Token; an OAuth browser flow is not implemented here.
- A non-loopback deployment requires a separate authenticated credential-management design before mutations can be enabled.
