# Agent Note: Kingsoft Docs browser login delegates to the official CLI

Status: implemented

English | [中文](2026-08-26-kingsoft-docs-cli-browser-login.zh.md)

## Problem

The first Kingsoft Docs connector required a personal Token and treated the provider's hosted endpoint as a dynamic MCP server. That path made users obtain and paste a credential even though the provider's current integration ships `kdocs-cli auth login`, which opens a browser authorization guide and persists the resulting authentication in the operating-system keychain.

Keeping the hosted-MCP adapter would preserve two competing authentication owners. The Harness credential store and MCP runtime would own one Token while the official CLI and keychain owned another. It would also couple the product to a remote catalog whose action names and authentication behavior can change independently of the official CLI release.

## Decision

[`@deepseek-ai/dsh-host-kingsoft-docs-connector`](../../../../packages/host/kingsoft-docs-connector/README.md) is a provider-specific browser-login and CLI gateway, not an MCP adapter. Its process-wide root entry owns the `kdocs-cli` subprocess lifecycle and the `kingsoftDocsConnector` Remote. Its `./tool` entry owns the preset-scoped model tools that invoke the same authenticated gateway.

An explicit loopback-page connect action first runs `kdocs-cli auth status --compact`. If no valid keychain login exists, it runs `kdocs-cli auth login` and waits within a configured budget, then checks status again before publishing `connected`. Disconnect removes the tool catalog immediately, waits for active calls, runs `kdocs-cli auth logout`, and verifies that authentication is absent. Browser arguments, Remote snapshots, public change events, model inputs, and session events never contain the saved credential. Trusted non-loopback pages can read credential-free status but cannot start or remove authentication.

The gateway invokes the CLI through `ctx.subprocess` with an explicit executable and argument vector, no shell, bounded stdin and output, caller cancellation, deadlines, and process-tree termination grace. Document action parameters travel as one complete JSON object over stdin using the CLI's `-` input marker. The legacy `KINGSOFT_DOCS_TOKEN` environment variable is removed from every child process so ambient state cannot bypass browser and keychain authentication.

The standard, code, and Cordis presets mount two stable tools while the gateway is connected; the minimal preset mounts neither. `kingsoft_docs_help` reads installed CLI help so the model can discover current service, action, and parameter names. `kingsoft_docs_call` accepts a fixed service enum, a kebab-case action, and one JSON parameter object. It requests one-shot local approval immediately before every authenticated operation. Its model description separately requires explicit user confirmation for irreversible delete or close actions and an independent read after writes.

The connector does not download or upgrade the provider binary. Operators install the official `kdocs-cli` and can override its executable path in composition. The provider's documented personal-account limitation remains visible; enterprise WPS accounts use the provider's WPS 365 integration.

## Alternatives considered

**Keep the hosted MCP Token connector.** Rejected: it duplicates the provider's current authentication owner, keeps credential entry in the browser, and depends on a hosted catalog instead of the official CLI release installed on the Host.

**Expose `auth set-token` in the Connectors panel.** Rejected: manual Token entry remains only a provider-documented recovery path. The normal product journey is browser authorization, and the browser must not handle the resulting credential.

**Register one Harness tool for every CLI action.** Rejected: the provider's catalog changes with CLI releases and would add a large, unstable schema prefix to every model request. The help-and-call pair keeps model names stable while making the installed CLI authoritative.

**Install or upgrade the CLI from the connector.** Rejected: executable acquisition and supply-chain policy belong to deployment. The connector reports a stable `CLI_NOT_FOUND` or `CLI_INCOMPATIBLE` state and links to the provider's installation guide.

**Skip approval for actions described as reads.** Rejected: one generic action bridge cannot use model-supplied action names as trusted policy. Every authenticated call uses the same last-mile approval, while irreversible operations also require an explicit task-level confirmation.

## Verification

Host tests cover login reuse, browser login, logout, keychain-state verification, command construction, stdin JSON, legacy environment removal, every safe failure code, output and input limits, caller cancellation, timeouts, process failure, teardown during login and logout, active-call draining, catalog activation, approval outcomes, and tool disposal with 100% statement, branch, function, and line coverage. Client tests cover independent Tencent and Kingsoft cards, loopback mutation fences, public read-only state, localized failures, carrier races, late settlements, login, retry, busy, and logout states with the same coverage. The assembled Web replay uses a local fake `kdocs-cli`, exercises browser-login state, confirms both schemas reach a keyless model request, grants one action approval, records the CLI result in the conversation, and verifies logout.

## Consequences

- Kingsoft Docs authentication is represented as a browser-login lifecycle, not a credential field or MCP catalog count.
- A valid keychain login survives Host restarts, but the connector starts disconnected; the next explicit Web login reuses and verifies it.
- The model receives exactly two Kingsoft tool schemas in the standard, code, and Cordis presets while connected. CLI help and action results enter context only after their tool calls and remain reconstructable from the session log.
- One process-wide personal-account login is shared by all sessions. Account selection and simultaneous accounts are not implemented.
- CLI installation and provider-version compatibility are deployment prerequisites rather than hidden connector mutations.
- The dynamic MCP seam remains the Tencent Docs integration path and no longer lists Kingsoft Docs as a Consumer.
