# Agent Note: HTML artifacts preview in the Web right column

Status: implemented

English | [中文](2026-08-17-web-html-artifact-preview.zh.md)

> Scope: HTML-family file clicks and manually entered HTTP(S) iframe tabs in the Web artifact column. Not in scope: Office documents, full browser navigation, or replacing native opening for other file types.

## Problem

The Web surface sent every file click back to the Host operating system. An HTML artifact therefore left the conversation for a new browser tab even though the current browser already had a resizable right column and could render the file directly. The browser could not load a Host filesystem path by itself, and serving an unrestricted path parameter would make the preview route an ambient file reader.

## Decision

The existing `openFile` callback consults the optional `chatFilePreview` service before native opening. The ui-deliverables plugin claims `.html`, `.htm`, and `.xhtml`, prepares the preview through `host.prepareArtifactPreview`, and opens the `artifact-preview` occupant of the shared details column. A declined extension or an absent provider continues through `workspaces.openPath`, so composition and non-HTML behavior remain unchanged.

The right column is a chain selected by the layout store's merge-extensible `DetailsPanelMap`. ui-conversation owns the `conversation` entry and ui-deliverables owns `artifact-preview`; AppFrame supplies the selected panel id without importing either feature. The layout service offers normal and wide open modes; HTML preview uses the 520px wide mode with a 480px center floor so fixed-width generated pages are not forced into the 360px tool-details viewport. Preview state is session-scoped, so switching sessions does not carry a file into another conversation. Each session retains one tab per distinct HTML path and keeps every ready iframe mounted while switching. The `+` action creates an empty tab whose form accepts HTTP(S), assumes HTTPS when the scheme is omitted, and turns that tab into a direct iframe; a supported file click can still claim an unused empty tab. Closing the last tab closes the details column.

The Host exchanges a resolved local entry path for an opaque URL and retains only its real parent directory. The GET route serves the entry and relative regular-file resources whose real paths remain inside that directory. Local entries and remote URLs share `sandbox="allow-scripts allow-same-origin"`, which lets interactive pages use origin storage but blocks forms and popups. Local response CSP additionally blocks connections, objects, nested frames, and base rewrites. Remote servers keep authority over embedding, so their CSP or `X-Frame-Options` may leave the iframe blank or show a browser error.

## Alternatives considered

- **Open a `file://` URL in the iframe** — browsers restrict local-file access and relative resources inconsistently, while a remote Web client cannot address the Host filesystem at all.
- **Return the HTML text through RPC and use `srcdoc`** — simpler for one file, but relative CSS, images, modules, and fonts lose their directory base.
- **Keep native opening for HTML** — preserves the old implementation but breaks the requested in-context workflow and cannot use the existing right column.
- **Build a full browser with an address bar and navigation controls** — adds history, permissions, popup, and download policy that the artifact column does not need; one explicit URL submission covers the requested embed workflow.

## Consequences

Clicking a produced-file chip or a matching inline-code mention opens HTML in the right column; another distinct path adds a tab, and tool-call details reclaim the column when selected. An empty tab can instead load one entered HTTP(S) URL, subject to iframe sandboxing and the remote site's embedding policy. Local previews support relative resources, inline scripts, interactions, and same-origin storage but deliberately cannot make network requests or submit forms. Unit coverage pins Host grants, retained tabs, URL validation, and iframe lifecycle, while `apps/web/tests/produced-file-mentions.e2e.ts` creates a real interactive HTML file, clicks its assembled mention, and exercises its button inside the iframe through the shipped Web composition.
