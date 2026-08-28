# Agent Note: Human artifact edits enter Agent context

Status: implemented

English | [中文](2026-08-28-human-artifact-edit-awareness.zh.md)

## Problem

The Web artifact editors saved human changes to the same workspace files that tools use, but a model could continue from conversation history without knowing that the file had changed. Sending complete HTML, Markdown, or OOXML content through the conversation would duplicate workspace state, consume unbounded context, and make the message rather than the file authoritative. A process restart between a save and the next prompt also required the notification to survive independently of browser state.

## Decision

Every successful built-in HTML, Markdown, DOCX, XLSX, or PPTX save identifies its owning session in the Host RPC. The Host resolves that session before writing, commits the revision-checked atomic file replacement, appends an `artifact/edited` session event with the canonical path, format, and saved revision, and flushes the session before acknowledging the save. A missing or unavailable session is rejected before the file changes.

The API gateway installs an `agent/pre-step` listener. It scans durable edit events after the latest logged `artifact-edit` context, takes at most the configured `artifactEditNoticeMaxItems`, and appends one user-role notice to the downstream enter decision. The notice names the changed paths and tells the model to treat current on-disk contents as authoritative and re-read them. Its source records the last covered event sequence, so a committed context is not delivered again, while a crash before message admission leaves the edit pending for the next step. Additional pending edits advance in bounded batches on later steps.

Saving does not wake an idle Agent. An edit joins the next step of work already in progress, or the next request triggered by a human prompt. The durable edit event records awareness state; the workspace file remains the content source of truth.

## Alternatives considered

- **Call `agent.inject()` directly after saving** — this is simple, but a process failure between the file rename and inbox mutation loses the only notice; a durable edit fact allows replay after restart.
- **Send the complete edited document as context** — this duplicates potentially large or binary content, spends context on OOXML projections, and can disagree with later disk state. The notice carries identity while tools read the authoritative file.
- **Wake the Agent on every save** — this starts unsolicited model turns while a person is still editing and can race several rapid saves. Non-waking delivery preserves explicit turn ownership.
- **Watch every workspace file** — external filesystem observation cannot reliably identify a human editor, adds platform-specific watch lifecycle, and would notify on the Agent's own tool writes. This feature records only Host-attested built-in editor saves.

## Consequences

Human changes made through all five built-in artifact editors become durable model-visible context without copying document bodies into the session. Active work observes edits at its next step; idle sessions observe them when the next prompt starts work. Multiple saves are ordered and bounded, and the conversation transcript records each admitted edit notice. Changes made by external applications or direct filesystem operations remain discoverable only when the Agent re-reads files; they do not produce `artifact/edited` events.

The existing HTML, Markdown, DOCX, XLSX, and PPTX Agent Notes continue to own each editor's projection, conflict handling, and write-back behavior. This decision adds the shared awareness lifecycle and does not supersede those records.
