# Agent Note: Local PPTX text-box editing through GenOffice

Status: implemented

English | [中文](2026-08-27-web-genoffice-pptx-editing.zh.md)

## Problem

Agent-produced PPTX files could be previewed externally, but the shipped Web application could not preserve slide layout while editing presentation text beside the conversation. The requested interaction is local: click the generated presentation, edit it in the right artifact column, and save back to the same path without service credentials or an upload lifecycle.

## Decision

The shipped Web composition enables a local `genoffice-pptx` artifact provider. The Host parses the pinned GenOffice PPTX engine representation, records the source SHA-256 revision in an opaque process-local grant, and returns slide size, background, top-level element geometry, pictures, shapes, and text boxes. The configured maximum bounds both the compressed source and the complete JSON projection after OOXML decompression.

The browser renders a PowerPoint-style workspace with presentation-specific tabs in the shared Office ribbon, a slide rail whose thumbnails reproduce projected slide content, previous/next controls, PageUp/PageDown navigation from any editor focus, selected-object status, and a proportional slide canvas. Eligible top-level text boxes are editable in place. Each slide-element pair owns its input instance and local composition draft, so slide changes, Host draft updates, and input-method composition do not replace an active caret. Every projected element can be selected with a pointer or keyboard; unsupported elements report their protected state instead of discarding the interaction. A selected editable text box exposes uniform font family, font size, bold, italic, underline, text color, and paragraph alignment controls. Text boxes containing fields, hyperlinks, mixed run formatting, or mixed paragraph alignment are protected because replacing them through the uniform editor would discard unsupported semantics. Groups, tables, charts, passthrough elements, inherited decorations, slide order, and element geometry remain display-only.

Saving sends changed text boxes through `host.saveGenOfficePptxArtifact`. The Host reopens the current bytes, validates slide and element indexes, verifies the grant revision and current file hash, applies complete text and uniform formatting replacements, and atomically replaces the original workspace file through a same-directory temporary file. GenOffice patches changed text and paragraph properties while preserving untouched OOXML package entries. A disk change returns `artifact-preview-conflict` without overwriting it.

Local PPTX preparation runs before configured external Office providers when enabled. Deployments can disable it and retain their external preview behavior.

## Alternatives considered

- **Embed the GenOffice Electron renderer** — it depends on Electron preload APIs and is not an embeddable Web component.
- **Render slides as disconnected text rows** — it loses the spatial relationships that make a presentation understandable and editable.
- **Offer per-run rich formatting immediately** — it would require selection-range editing and safe reconstruction of mixed fields, hyperlinks, and inherited styles before the local save path was established.
- **Make every slide element editable** — structural edits need separate insertion, deletion, media, relationship, and layout operations; presenting them as available would overstate this slice.

## Consequences

Generated PPTX files can now open as positioned slides in the right column. Users can edit eligible text boxes and common whole-box formatting, then save back to the same workspace path. Real-engine unit tests reparse saved bytes and cover external-change conflicts; client tests cover the canvas, toolbar, draft, and save state; the keyless assembled Web scenario edits a real PPTX and reparses the saved file from disk.

This is not a full PowerPoint replacement. It does not add, remove, resize, or reorder slides or elements, and it protects mixed-format and complex structures. XLSX editing remains a separate capability slice.
