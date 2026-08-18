# `@deepseek-ai/dsh-client-ui-meeting`

English | [中文](README.zh.md)

Web client plugin contributing the Meetings action to `sidebar.footer.action`. The action opens a modal with one Google Meet or Zoom URL field and renders the complete Host-owned participant state: idle, starting, waiting for admission, joined, leaving, left, or failed. The trigger remains marked while a participant is active; closing the modal does not stop it.

The plugin calls the `meetingPresence` Remote and subscribes to `meeting-presence/change`, so admission changes arrive without polling. A panel open also reads the current Host snapshot to recover state missed while the panel or connection was absent. Product copy states that the participant does not record or upload meeting content.

## Model Experience

### What the model sees

Nothing. The panel is a human control and adds no model-visible input.

### Token effect

None.

### KV Cache effect

None.

## Known Limitations and Deferred Work

- The panel accepts Google Meet only and exposes no provider selector.
- State belongs to one Host process rather than a session or workspace.
- The UI does not show browser diagnostics beyond the bounded Host failure message.
