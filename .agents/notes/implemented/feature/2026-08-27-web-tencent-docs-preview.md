# Agent Note: Local document preview through Tencent Docs WebSDK

Status: implemented

English | [中文](2026-08-27-web-tencent-docs-preview.zh.md)

## Problem

The Web artifact column could render HTML, edit Markdown, and delegate DOCX editing to an optional Document Server, but it had no browser renderer for spreadsheets, presentations, PDF, legacy Office formats, or a read-only document workflow. Native opening also hands the file to the Host desktop rather than keeping the result beside the conversation.

## Decision

The Web composition can configure Tencent Docs WebSDK as an optional read-only artifact provider. The preview controller claims DOC, DOCX, TXT, XLS, XLSX, CSV, PPT, PPTX, and PDF paths. The Host prepares a discriminated `tencent-docs` value containing the SDK URL and browser-safe initialization fields. The client loads that script once per URL, initializes the SDK inside the retained artifact tab, waits for readiness, and destroys the SDK instance when the tab unmounts.

The local file remains the source of record. Preparation resolves the real regular-file path, creates opaque process-local file and download capabilities, resolves the application secret through the credential service, and computes the Tencent application signature. The secret never enters RPC or browser state. Tencent's signed callback requests receive read-only permission, file metadata, a capability download URL, and a disabled watermark response. The download route supports full reads and one HTTP byte range so the remote renderer can seek through larger formats. Copy, comment, and print permissions are disabled.

The deployment provides an application id, a credential reference, and a public HTTPS Harness origin. Tencent must be able to reach `<public-origin>/api/tencent-docs`, and the Web trust fence must admit that authority. Every explicit reopen prepares a fresh grant so a retained tab can recover after a Host restart. If the provider is absent, the Host declines these document extensions; the client removes its provisional file tab and lets the ordinary native opener continue. An unused blank artifact tab is restored when that handoff occurs. The existing editable DOCX provider remains an independent fallback when Tencent Docs is absent.

Closing-message mentions accept exact supported document paths without mutation locations because terminal processes commonly create binary artifacts. The produced-files row remains derived from authoritative mutation locations.

## Alternatives considered

- **Upload each file into a Tencent Docs workspace** — changes asset ownership and lifecycle, while WebSDK already renders bytes supplied through callbacks.
- **Expose a direct local path or stable public file URL** — leaks Host filesystem identity or grants broader access than one preview operation requires.
- **Initialize the SDK entirely in the browser** — cannot protect the application secret or answer Tencent's server callbacks.
- **Build format renderers in the Harness client** — makes Office and PDF compatibility a Harness responsibility and duplicates a maintained document engine.

## Consequences

A configured Web deployment previews the supported document families beside the conversation while their bytes stay in the local workspace. Tencent's service necessarily receives those bytes during rendering, so this is not an offline preview. The integration is read-only: it does not save edits, create a Tencent Docs asset, provide collaboration, or invoke Tencent Docs MCP tools. Grants disappear on restart and are replaced on the next explicit click. Host tests pin signing, callback authentication, metadata, capability downloads, HTTP ranges, and error classification; client tests pin interception, optional-provider handoff, retained-tab refresh, and SDK lifecycle. The existing ONLYOFFICE Agent Note remains active because it owns a separate editable DOCX and write-back decision.
