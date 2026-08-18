# Agent Note: Editable DOCX artifacts through ONLYOFFICE

Status: implemented

English | [中文](2026-08-18-web-docx-onlyoffice-editing.zh.md)

## Problem

The Web artifact column could host browser-renderable HTML but Chromium cannot interpret DOCX OOXML as an editable document. Treating DOCX as an iframe URL produces a download rather than Word-compatible layout and editing, while converting to PDF would discard the requested editing path.

## Decision

The ui-deliverables preview controller also claims `.docx` and retains an Office renderer beside its HTML iframe renderers. The Host returns a discriminated preview value: HTML carries its same-origin URL, while DOCX carries the external ONLYOFFICE Docs API URL and a `word`/`docx` editor configuration. The configuration includes an empty `editorConfig.customization` object because ONLYOFFICE 9.4 reads that object before applying optional settings. The client loads that API once, mounts `DocsAPI.DocEditor` inside the active right-column tab, keeps the editor mounted across tab switches, and destroys it when the tab closes.

The closing-prose mention resolver accepts an exact `.docx` inline-code token even when the turn records no produced mutation location. Binary DOCX output is normally created by a terminal process rather than a text mutation tool, so it cannot otherwise become a clickable artifact. The ordinary chat file opener resolves the token against the session cwd, and the Host still rejects a missing or non-file target when the user clicks it. The produced-files row remains limited to authoritative mutation locations.

Selecting an existing DOCX path prepares a new grant and replaces its editor configuration instead of only activating the retained editor. Grants are process-local and expire on Host restart; re-preparation lets the next explicit file click recover the tab without discarding it. HTML retains its iframe on repeated selection because preserving interactive page state is its defining tab behavior.

The Host owns the local path and issues one opaque in-memory grant. ONLYOFFICE downloads the current bytes from the grant's file route. Save callbacks with status `2` or `6` carry a Document Server download URL; the Host fetches those bytes into a sibling temporary file and renames it over the granted workspace path before acknowledging success. Other callback states are acknowledged without changing the file.

Deployments configure two addresses because the browser and Document Server can have different network views: `browserUrl` reaches ONLYOFFICE from the browser, while `harnessUrl` reaches Harness from ONLYOFFICE. The Web bundle sources them from `DSH_ONLYOFFICE_URL` and `DSH_ONLYOFFICE_HARNESS_URL`. DOCX preparation reports unavailable when either address is absent. The first integration intentionally supports modern `.docx` only and expects a local trusted deployment with ONLYOFFICE JWT disabled; legacy DOC, spreadsheets, presentations, collaborative identity, and version history remain outside this decision.

## Alternatives considered

- **Convert DOCX to PDF** — provides a stable browser preview but cannot preserve an editable Office workflow.
- **Convert OOXML to ordinary HTML** — supports partial viewing, but round-tripping Word layout, tables, pagination, images, and styles would require a document editor rather than a converter.
- **Implement a Word editor in the Harness client** — duplicates a mature document engine and makes OOXML compatibility part of the Harness UI.
- **Support every Office format in the first integration** — increases save and conversion cases before the document-server lifecycle is established; DOCX provides one complete vertical path.

## Consequences

A configured Web deployment opens DOCX artifacts in an editable Word-compatible UI without PDF conversion and writes completed saves back to the original workspace path. Browser-to-ONLYOFFICE and ONLYOFFICE-to-Harness reachability are both deployment requirements; Docker commonly uses different origins for them. The grant is process-local, edits replace the source file, and this local-first path does not provide JWT authentication, revision history, conflict resolution, or recovery after Host restart. The shared RPC error schema includes both artifact-preview error codes so an unavailable deployment remains a business error instead of becoming a client-side response validation failure. Host tests pin configuration, file serving, callback state handling, write-back, and error parsing; client tests pin DOCX interception and `DocEditor` lifecycle.
