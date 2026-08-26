# Agent Note: Personal QQ Mail uses bounded IMAP and SMTP tools

Status: implemented

English | [中文](2026-08-26-personal-qq-mail-connector.zh.md)

## Problem

The public Agently Mail CLI authorizes an isolated Agent Mail workspace rather than the user's existing personal QQ mailbox. WorkBuddy's personal-mail connector appears to rely on a private provider integration that is not available as a public MCP endpoint or reusable OAuth client. The shipped connector must not label a separate Agent Mail account as the user's QQ mailbox.

## Decision

[`@deepseek-ai/dsh-host-qq-mail-connector`](../../../../packages/host/qq-mail-connector/README.md) connects a personal `@qq.com` mailbox through QQ Mail's standard IMAP and SMTP endpoints. A loopback user supplies the mailbox address and an IMAP/SMTP authorization code through opaque credential references. The authorization code is not the QQ password. The Host verifies it over IMAP and publishes only credential-free lifecycle state.

The `standard`, `code`, and `cordis` presets mount a scoped Consumer that registers `qq_mail_list`, `qq_mail_search`, `qq_mail_read`, and `qq_mail_send` only while the account is connected. Each tool requests one-shot Harness approval immediately before the network operation. Message content is untrusted data and never gains authority to direct the agent.

Credentials are resolved for every IMAP or SMTP operation and are never cached in snapshots, public events, model requests, results, or logs. Protocol logging is disabled. Operations and returned bodies are bounded, read results omit attachment bytes, and authentication and network errors are normalized.

## Alternatives considered

**Keep the Agently Mail CLI connector.** Rejected because it exposes the CLI's isolated Agent Mail account, not the user's personal QQ mailbox.

**Replicate WorkBuddy's browser login.** Rejected because no public provider OAuth client, redirect contract, or API is available. Copying the appearance without the provider relationship would not create a valid personal-mail authorization flow.

**Configure QQ Mail as hosted MCP.** Rejected because QQ Mail does not supply a compatible public MCP endpoint for this account flow. IMAP and SMTP are the published mail-client protocols.

**Expose raw IMAP or SMTP commands.** Rejected because protocol commands would create an unsafe, unstable model surface. Four domain tools keep validation and user approval explicit.

## Verification

Package tests cover missing and rotating credentials, account verification, list/search/read/send behavior, response bounds, safe failures, catalog registration, validation, and approval outcomes. Browser and Host fence tests cover credential drafts, event forwarding, loopback-only mutations, and safe public reads. The assembled preset catalog proves the four QQ Mail tools appear only when the Consumer is mounted and the account is connected.

## Consequences

- The connector accesses the user's personal QQ mailbox after the user enables IMAP/SMTP and generates an authorization code.
- QQ Mail remains independent of the generic MCP runtime and its remote tool discovery.
- The first version supports Inbox list/search/read and plain-text send; folders, attachment transfer, deletion, reply, forward, and rich composition remain unsupported.
- A future official MCP endpoint or partnered OAuth integration can replace the provider without changing the four user-facing tool purposes.
