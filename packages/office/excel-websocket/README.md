# `@deepseek-ai/dsh-office-excel-websocket`

English | [中文](README.zh.md)

Loopback WebSocket provider for `ctx.officeExcel`. An Excel task pane connects at `/api/office-excel`, binds exactly one live Harness Session to a workbook, receives correlated tool invocations, executes them through Office.js, and returns lossless JSON results. A newer connection replaces the previous connection for that Session. Disconnect, cancellation, delivery failure, and timeout settle every pending call explicitly.

The default origin allowlist admits only `https://localhost:3010`, the development Office Add-in host. Deployments must enumerate any other origin.

## Model Experience

Indirectly, through `dsh-tool-excel`, whose ordinary tool result carries any transport failure.

#### KV Cache effect

The Provider adds no request prefix; append-only tool results do not rewrite prior request tokens.

## Known Limitations and Deferred Work

- Binding requires a live Agent; a task pane reconnecting to a cold persisted Session must first resume that Session through the ordinary API.
- The provider is a local single-user transport and does not authenticate remote network clients beyond the exact Origin allowlist.
