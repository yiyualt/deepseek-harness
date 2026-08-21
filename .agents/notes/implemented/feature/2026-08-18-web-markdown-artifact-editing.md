# Agent Note: local Markdown editing in the Web artifact column

Status: implemented

English | [中文](2026-08-18-web-markdown-artifact-editing.zh.md)

## Problem

The Web artifact column could display HTML and delegate DOCX to ONLYOFFICE, but clicking a local Markdown file still left the application. Markdown already had an in-product renderer for assistant messages, yet the browser could not read or save an arbitrary Host path. Treating Markdown as an iframe page would display source text without an editor or a reliable write-back path.

## Decision

The ui-deliverables preview controller claims `.md` and `.markdown` beside HTML and DOCX. Exact Markdown inline-code paths remain clickable even without a produced mutation location, covering terminal-created text artifacts. The Host reads at most 2 MiB of UTF-8 source from the canonical regular-file path, returns the source with its SHA-256 revision and an opaque process-local edit grant, and never exposes the filesystem path as a browser URL.

The right-column tab renders a split source editor and live preview. The preview reuses `MarkdownText`, so local artifacts share the established CommonMark, GFM, code, math, URL, raw-HTML, and remote-image behavior of assistant Markdown. Editing changes session-local draft state; Save sends the complete source, grant, and last observed revision to the Host.

The Host reads the file again before saving. A changed revision returns `artifact-preview-conflict` and leaves both disk content and the browser draft intact. A matching revision is written to a sibling temporary file and renamed over the granted path, then the returned revision becomes the next save precondition. Grants expire on Host restart, and reopening the file obtains a new source snapshot and grant.

## Alternatives considered

- **Render the Markdown in an iframe** — a browser can show served plain text, but the iframe adds no Markdown parser, source editor, or controlled write-back operation.
- **Save directly from the browser by path** — would put an ambient Host path in an ordinary request and allow stale browser state to overwrite Agent or external changes.
- **Reuse ONLYOFFICE** — adds a document server to a text format the existing client already parses, and provides a word-processing interface rather than Markdown source semantics.
- **Overwrite without a revision check** — is simpler but makes human-and-Agent editing last-writer-wins with silent data loss.

## Consequences

Clicking a produced `.md` or `.markdown` artifact opens a retained tab with editable source and immediate rendered output; Save writes to the original local file without PDF conversion or an external document engine. The 2 MiB limit bounds RPC and DOM cost. Saving is whole-file and single-user: it detects concurrent changes but does not merge them, keep history, autosave, or coordinate cursors. Unit tests pin grant reads, revision conflicts, client state, and rendering; the assembled Web scenario edits a real Markdown artifact and verifies the bytes written to disk.
