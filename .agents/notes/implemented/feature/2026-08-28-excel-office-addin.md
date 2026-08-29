# Agent Note: Excel Office Add-in

Status: implemented

English | [中文](2026-08-28-excel-office-addin.zh.md)

## Problem

DeepSeek Harness had browser chat and standalone workbook artifact generation, but no way for an Agent to operate the workbook currently open in desktop Microsoft Excel. A Host-only Excel SDK would not identify the user's workbook and would move document authority outside Excel. The integration needs an Excel-owned execution boundary, exact Session routing, explicit disconnect behavior, and an independently sideloadable task pane.

## Decision

The feature is split into four plugins. `dsh-office-excel` defines the single-provider capability seam. `dsh-office-excel-websocket` provides a loopback, exact-Origin WebSocket route and binds one live Harness Session to one workbook connection. `dsh-tool-excel` contributes six model-facing tools whose calls route by the calling Agent's Session id. `dsh-office-addin` is the independent React/Vite task pane; it reuses the existing HTTP unary API and WebSocket mux for chat, while the reverse WebSocket carries only correlated Office.js invocations and JSON results.

The task pane reduces both live mux events and durable Session history into one timeline model. It renders only `user/message` records whose `source.kind` is `user`; workspace instructions, runtime context, skill catalogs, and other model-context injections remain in Session history without appearing as human chat bubbles. It renders reasoning deltas while the model is thinking, text deltas while the answer is produced, and tool calls as lifecycle cards with pending, successful, or failed status. Mux request ids are retained so `ask_user_question` and approval requests become interactive cards whose results are returned through `/api/respond`; an Agent turn therefore does not remain stuck behind an invisible interaction.

Excel remains the document authority. Inspection, bounded reads, rectangular literal writes, clears, worksheet creation, and chart-object insertion run through `Excel.run` inside the task pane. Worksheet creation rejects duplicate or invalid names and can activate the new sheet. Chart insertion uses an explicit bounded source range and destination cells, and returns the created object's name, type, title, and geometry. The Host never chooses a process-global active workbook. A missing Provider, unbound Session, send failure, cancellation, timeout, Office.js error, or disconnect settles with a stable failure instead of hanging.

The development manifest points to `https://localhost:3010`; Vite proxies HTTP and WebSocket traffic to DSH Web on port 3080. It rewrites the Origin of DSH mux and host downlinks to the upstream Origin while retaining the browser Origin for the separately allowlisted Excel provider. Both the chat downlink and workbook execution socket reconnect with bounded backoff after a DSH restart. The macOS sideload helper copies the manifest into Excel's `wef` directory. Local TLS trust remains a user-approved operating-system action.

## Verification

Service tests cover Session-routed invocation, unavailable and disconnected failures, duplicate Provider rejection, disposal, and pre-abort behavior. WebSocket tests exercise a real local socket pair for correlated success and in-flight disconnect settlement. Add-in tests cover worksheet creation, chart-object creation and read-back, unsupported chart rejection, streaming reasoning, final-answer replacement, tool lifecycle state, durable history replay, injected-context filtering, and mux request-id preservation. The three Host packages pass composite TypeScript build and type-aware lint; the Add-in passes standalone typecheck, focused tests, and production Vite build. The macOS manifest was copied to Excel's sideload directory.

## Alternatives considered

**Automate Excel from the Harness process.** Rejected because it makes workbook identity, permissions, and lifecycle implicit and platform-specific; Office.js already has the authoritative in-document context.

**Put Excel logic directly in the Web bundle.** Rejected because ordinary browsers do not expose Office.js and cannot own the task-pane lifecycle.

**Reuse the chat event channel for tool execution.** Rejected because the chat mux WebSocket is intentionally downlink-only. Tool execution needs request/result correlation, cancellation, and disconnect settlement, so it has a separate bidirectional WebSocket.

## Consequences

Opening the sideloaded Add-in creates or resumes a DSH Session and binds that exact Session to the current workbook. The Agent can inspect and modify the workbook with six bounded tools without giving the Host direct Excel automation authority. Formula authoring, formatting, tables, pivots, chart restyling and series editing, large-range pagination, production authentication, and Windows sideload automation remain deferred.
