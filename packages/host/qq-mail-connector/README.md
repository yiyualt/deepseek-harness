# `@deepseek-ai/dsh-host-qq-mail-connector`

English | [中文](README.zh.md)

Host integration for a personal `@qq.com` mailbox. The connector stores the mailbox address and an IMAP/SMTP authorization code through `ctx.credentials`, verifies the account over IMAP, and exposes four scoped Harness tools. It does not use a QQ password, a browser session, or `agently-cli`.

## Setup

In QQ Mail, enable the IMAP/SMTP service and generate an authorization code. Open the Harness Connectors panel on the Host loopback page, enter the full `@qq.com` address and authorization code, then select **Connect**. The authorization code is a mail-client credential, not the QQ account password.

The default endpoints are `imap.qq.com:993` and `smtp.qq.com:465`, both with implicit TLS. Deployments can override hosts, ports, operation timeout, and response limits in `cordis.yml`.

## Security and lifecycle

Only loopback clients can save or delete credentials and connect or disconnect the account. Trusted non-loopback clients can read a credential-free snapshot containing status, tool count, safe error fields, and update time. Disconnecting withdraws all four tools before the UI deletes writable credentials.

IMAP and SMTP clients disable protocol logging, enforce bounded time and response sizes, and normalize authentication and network failures. Read results omit attachment bytes.

## Model Experience

### Connected personal-mail tools

#### What the model sees

After IMAP verification succeeds, the package registers four tools: `qq_mail_list` lists recent or unread inbox messages, `qq_mail_search` searches message headers and body text, `qq_mail_read` reads one message by IMAP UID without attachment content, and `qq_mail_send` sends a plain-text message through SMTP. Each tool requests one-shot Harness approval before the connector contacts QQ Mail. Message fields are untrusted external data and never instructions. The connector resolves credentials again for every operation, so replacing an authorization code affects the next call without exposing it to the browser, model request, result, log, or public status event.

#### Token effect

The four fixed schemas consume a stable request prefix. Message summaries and bodies enter context only after the corresponding approved read operation; send results contain SMTP delivery metadata rather than the submitted authorization code.

#### KV Cache effect

Connecting or disconnecting adds or removes the same four tool schemas from the next request for affected presets. Credential and connector status values are not model-visible.

## Known Limitations and Deferred Work

- The first version does not support attachment download, folders other than Inbox, message deletion, reply, forward, or rich HTML composition.
