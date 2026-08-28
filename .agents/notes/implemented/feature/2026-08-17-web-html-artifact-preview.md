# Agent Note: HTML artifacts preview in the Web right column

Status: implemented

English | [中文](2026-08-17-web-html-artifact-preview.zh.md)

> Scope: HTML-family file editing and manually entered HTTP(S) iframe tabs in the Web artifact column. Not in scope: Office documents, full browser navigation, or replacing native opening for other file types.

## Problem

The Web surface sent every file click back to the Host operating system. An HTML artifact therefore left the conversation for a new browser tab even though the current browser already had a resizable right column and could render the file directly. The browser could not load a Host filesystem path by itself, and serving an unrestricted path parameter would make the preview route an ambient file reader.

## Decision

The existing `openFile` callback consults the optional `chatFilePreview` service before native opening. The ui-deliverables plugin claims `.html`, `.htm`, and `.xhtml`, prepares the preview through `host.prepareArtifactPreview`, and opens the `artifact-preview` occupant of the shared details column. A declined extension or an absent provider continues through `workspaces.openPath`, so composition and non-HTML behavior remain unchanged.

The right column is a chain selected by the layout store's merge-extensible `DetailsPanelMap`. ui-conversation owns the `conversation` entry and ui-deliverables owns `artifact-preview`; AppFrame supplies the selected panel id without importing either feature. The layout service offers normal and wide open modes; HTML editing uses the 520px wide mode with a 480px center floor so fixed-width generated pages are not forced into the 360px tool-details viewport. Preview state is session-scoped, so switching sessions does not carry a file into another conversation. Each session retains one tab per distinct HTML path. The `+` action creates an empty tab whose form accepts HTTP(S), assumes HTTPS when the scheme is omitted, and turns that tab into a direct iframe; a supported file click can still claim an unused empty tab. Closing the last tab closes the details column.

The Host exchanges a resolved local entry path for separate opaque resource and edit grants. Preparation returns bounded UTF-8 source and its SHA-256 revision; the GET route serves the entry and relative regular-file resources whose real paths remain inside the granted directory. The visual editor renders the source through `srcdoc`, inserts a same-origin base URL for those granted resources, disables scripts, and enables browser-native document editing. It serializes the edited DOM back to HTML without the injected base or CSP metadata. Source mode edits the complete text directly for changes that require exact tags, styles, or scripts.

`host.saveHtmlArtifact` accepts complete source only through the edit grant. The Host verifies the current file hash against the supplied revision and atomically replaces the original through a sibling temporary file; an external change returns `artifact-preview-conflict` without overwriting it. Manually entered remote URLs remain sandboxed iframe tabs with scripts and same-origin behavior; remote servers retain authority over embedding, so their CSP or `X-Frame-Options` may leave the iframe blank or show a browser error.

## Alternatives considered

- **Open a `file://` URL in the iframe** — browsers restrict local-file access and relative resources inconsistently, while a remote Web client cannot address the Host filesystem at all.
- **Keep the local page as a script-enabled iframe** — preserves every runtime interaction, but same-origin script execution is incompatible with parent-driven visual editing; source mode retains scripts in the saved file while visual editing disables their execution.
- **Edit only raw HTML source** — preserves exact text but makes ordinary copy changes unnecessarily difficult; source mode remains available beside direct visual editing.
- **Keep native opening for HTML** — preserves the old implementation but breaks the requested in-context workflow and cannot use the existing right column.
- **Build a full browser with an address bar and navigation controls** — adds history, permissions, popup, and download policy that the artifact column does not need; one explicit URL submission covers the requested embed workflow.

## Consequences

Clicking a produced-file chip or a matching inline-code mention opens an editable HTML page in the right column; another distinct path adds a tab, and tool-call details reclaim the column when selected. Visual mode supports direct browser-native text and structure edits while retaining relative local styles, images, and fonts; source mode exposes the complete HTML. Saving rewrites the original file only when its revision matches. Visual mode does not execute page scripts, so script-driven output must be changed in source mode and observed after reopening outside the editor. An empty tab can instead load one entered HTTP(S) URL, subject to iframe sandboxing and the remote site's embedding policy. Unit coverage pins preparation, atomic saves, conflicts, retained tabs, URL validation, and both editing modes; the assembled Web scenario changes a real HTML heading in visual mode, saves it, and verifies the workspace bytes.
