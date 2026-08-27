# Agent Note: Local DOCX rich-text editing through GenOffice

Status: implemented

English | [中文](2026-08-27-web-genoffice-docx-editing.zh.md)

## Problem

Agent-produced DOCX files could be handed to external preview or document services, but the shipped Web application could not edit a workspace document beside the conversation without service credentials or an upload lifecycle. The requested interaction is local: click the generated file, edit it in the right artifact column, and save back to the same path.

## Decision

The shipped Web composition enables a local `genoffice-docx` artifact provider. GenOffice's DOCX and PPTX engine sources are pinned at commit `583a045212f871943afb8ca4503fcb5ddf99a23f`, vendored under the repository build, and bundled into the Host gateway. DOCX preparation therefore needs no application id, credential, public callback URL, or document server.

The Host owns paths and OOXML. Preparation resolves a real regular file, enforces the configured `genOfficeDocxMaxBytes`, parses it, records the source SHA-256 revision in an opaque process-local grant, and returns browser-safe block projections. Ordinary paragraph, heading, and list-item runs without atomic fields or tracked structural changes are editable. Tables, images, formulas, fields, text boxes, tracked changes, and other complex content are protected projections.

The browser presents editable blocks as one continuous TipTap document page with an Office-style tab row and selection-aware Home ribbon. Home commands provide undo, redo, font family, font size, bold, italic, underline, strikethrough, font color, highlight, paragraph alignment, and select-all operations against the current text range; mixed formatting has an explicit indeterminate state. Enter inserts a soft line break in the current OOXML paragraph, and the generated run preserves it as `<w:br/>`. A non-empty range opens a contextual formatting toolbar and reports its character count. Unsupported tabs remain visible but expose no document mutation command. The artifact column opens at 520px and can be dragged to 960px while the layout preserves at least 480px for the conversation. A transaction guard preserves the original top-level block index sequence, so character and supported paragraph formatting cannot merge, split, insert, or delete OOXML body blocks. Saving sends block indexes and complete formatted runs through `host.saveGenOfficeDocxArtifact`. The Host validates every index against the granted parse, rejects unknown or protected blocks, verifies both the grant revision and current file hash, asks GenOffice to regenerate only changed paragraphs, and atomically replaces the original file through a same-directory temporary file. Unchanged and protected OOXML body elements remain original save blocks. A disk change returns `artifact-preview-conflict` and preserves both files.

Local GenOffice DOCX preparation runs before configured external Office providers when enabled. Deployments can disable it and retain their existing Tencent Docs or legacy DOCX provider behavior. The existing Tencent Docs and ONLYOFFICE notes retain independent value for those deployment choices; neither is archived by this decision.

The same local provider pattern serves XLSX through `genoffice-xlsx`. The Host parses workbook cells with GenOffice, issues a revision-bound grant, and applies value, formula, and supported style deltas through `host.saveGenOfficeXlsxArtifact`. A shared Office-style tab row gives DOCX, XLSX, and PPTX consistent navigation while preserving format-specific commands. XLSX uses GenOffice's free Univer sheet preset, including its native selection, ribbon, formula bar, grid, sheet bar, and zoom controls. Save verifies the current hash and atomically replaces the original workbook; untouched OOXML package entries remain intact.

## Alternatives considered

- **Embed the GenOffice Electron applications** — their renderers depend on Electron preload APIs and are not an embeddable Web SDK.
- **Upload files to a hosted editor** — adds credentials, network access, and remote asset lifecycle to a local editing request.
- **Flatten the document to plain text** — would discard OOXML content and formatting instead of preserving protected blocks.
- **Enable every GenOffice control in the first change** — would copy a large desktop UI and mix DOCX, PPTX, and XLSX host architectures before the shared grant and write-back path was proven.

## Consequences

Generated DOCX files can be opened, edited as continuous rich text, and saved back to the same workspace path entirely inside the shipped Web application. Host unit tests exercise formatted GenOffice parse/save round trips and external-change conflicts; client tests cover ribbon tabs, document state, drafts, and saves; the keyless assembled Web scenario selects and formats text through the contextual toolbar, saves a real DOCX, and reparses its bytes from disk.

This is not a full Word- or Excel-compatible editor. DOCX protects complex blocks and omits paragraph insertion, headers, comments, and page layout. XLSX supports ordinary cells, formulas, common formatting, and multiple sheets, but not every chart, pivot, drawing, macro, or advanced workbook feature. PPTX editing is owned by its separate browser projection and save adapter.
