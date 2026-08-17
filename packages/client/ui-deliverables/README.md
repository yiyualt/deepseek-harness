# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

Produced-files and clickable-reference feature owner. The Node half registers final-response guidance with the system-prompt registry; the browser half registers the deliverables row a finished turn ends with into the chat view's `conversation.chat.turnTail` hole and links matching inline-code references in the closing prose. The shipped Web patch is the only composition that loads this package. Removing its one cordis.yml entry removes the guidance, row, and prose links together.

`deliverablesDefinition` folds each Turn's successful mutation calls into engine-published `DeliverablesTurnData`; `producedForClosing` reads that data with the closing Assistant seq. The vocabulary is the mutation tools' own follow-along `locations`, never the closing prose: a produced file is listed whether or not the model remembered to name it. A mutation is recognized by render intent, not tool name — a diff card, or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents) — so a new mutation tool joins by declaring what it does. Reads, deletes, and failed calls contribute nothing; a path appears once per Turn in first-seen order. The Conversation Location index owns Turn membership, so a Turn that mutates and then ends without content text cannot spill into the next Turn's row.

`ProducedFiles` renders the row between the closing message's body and its IconActions footer: a quiet label and one measured file lane. It shows the largest leading prefix that fits (up to six chips; basename text, full path as the `title`) while reserving the exact localized `+ N files` width, so the remainder stays visible without wrapping or horizontal scrolling. Each chip opens through the owner-supplied `openFile` — the same Host opener the tool rows use, with the chat view resolving relative paths against the session cwd. When files are hidden, a second-line **Show in folder** action opens the session workspace through that same owner path only while the page is loopback and the current Host handshake reports `canOpenPath`; direct remote Web and headless/container Linux Hosts omit the action by default. Design rationale: the [workspace file links Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md).

HTML, HTM, XHTML, and DOCX clicks first open the shared right column using the layout's 520px wide mode. Each distinct path adds a tab; selecting an existing HTML path reactivates its retained iframe, while selecting an existing DOCX path prepares a fresh grant and remounts its editor so a Host restart cannot strand the tab on an expired token. The visible `+` adds an empty tab that the next supported click fills, and closing the last tab closes the column. HTML uses a sandboxed iframe with scripts and same-origin storage; the Host exchanges the resolved path for an opaque preview URL and serves the entry plus relative resources from its directory. DOCX uses an editable ONLYOFFICE `DocEditor`; the Host supplies its API URL and document configuration, while the Document Server downloads and saves through opaque Host routes. Other file types and a composition without the preview provider retain the native opener. The [HTML preview](../../../.agents/notes/implemented/feature/2026-08-17-web-html-artifact-preview.md) and [DOCX editing](../../../.agents/notes/implemented/feature/2026-08-18-web-docx-onlyoffice-editing.md) decisions record the ownership and deployment rules.

The closing prose carries the same vocabulary. This plugin provides the `chatFileMentions` service the chat view consults per closing message: `producedFileMentions` resolves an inline-code token by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing. An exact `.docx` token also resolves without a produced mutation location because binary documents are commonly created by a terminal process; the Host validates existence when clicked. A resolved mention keeps its code chip and takes the markdown sheet's link language — link-blue at rest, underlined on hover, exactly like URL-promoted inline code — with the full path as its `title`; mentions never render inside anchors or streaming text. Decision records: the [inline file mentions](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md) and [DOCX editing](../../../.agents/notes/implemented/feature/2026-08-18-web-docx-onlyoffice-editing.md) Agent Notes.

The Node half registers the static `ui:deliverable-file-references` system-prompt section. It asks the model to mention the primary files it successfully created or modified and to write those and any other changed-file references as Markdown inline code, using the exact file-tool path or a basename only when unique within the Turn. The guidance makes the renderer's accepted syntax explicit; it does not govern unrelated path discussions or widen the renderer's successful-mutation vocabulary.

## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at order 190 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

- **Mention matching is exact path or unique basename only.** A suffix mention (`out/index.html` written as `index.html` resolves; `deep/out/index.html` written as `out/index.html` does not) stays inert; widening the matcher is deferred until a real closing-message shape needs it.
- **Files created indirectly by terminal commands remain outside the produced-files row.** An exact DOCX inline-code path is clickable, but other terminal-created formats need a successful mutation location.
- **HTML previews do not provide a general browser tab.** The iframe blocks forms, nested frames, objects, and network connections; use the native opener when a generated page needs those capabilities.
- **Native folder handoff targets the Host desktop.** A browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener. SSH forwarding that makes a remote Host look loopback-local must set the gateway's `nativeOpen: false`; so must a headless macOS/Windows Host, a WSL deployment without working Windows interop, or any Linux desktop whose display/opener probe is a false positive. Identifying the operator-visible desktop remains deployment policy.
