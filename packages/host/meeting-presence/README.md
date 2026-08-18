# `@deepseek-ai/dsh-host-meeting-presence`

English | [中文](README.zh.md)

Web Host service for one process-wide, presence-only Google Meet or Zoom participant. The `meetingPresence` Remote validates a platform URL, starts its packaged Playwright driver through `ctx.subprocess`, and publishes complete state snapshots through `meeting-presence/change`. Each driver opens a fresh Chrome context, enters the configured participant name, requests admission, and remains in the call until the user asks it to leave, the meeting removes it, or the Host unloads the plugin.

The drivers contain no recording, transcription, screenshot-upload, or object-storage path. Their ambient child environment is credential-scrubbed by the subprocess provider. URL validation accepts canonical Google Meet links and Zoom `/j/` or `/wc/join/` links; all other hosts and paths fail before a browser starts, so the service cannot be used as a general Web navigator. A Zoom `pwd` query value is retained while unrelated query fields are removed.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `botName` | `DeepSeek AI 会议助手` | Participant name visible to attendees. |
| `joinTimeoutMs` | `120000` | Maximum wait for host admission. |
| `statusPollMs` | `500` | Worker admission/removal observation interval. |
| `processGraceMs` | `5000` | TERM-to-KILL subprocess cleanup grace. |
| `headless` | `false` | Whether Chrome opens without a visible window. |
| `chromeExecutablePath` | unset | Explicit Chrome path; unset selects Playwright's installed Chrome channel. |

Only one participant may run at once. `join` refuses while the current state is `starting`, `waiting-admission`, `joined`, or `leaving`. `leave` requests tree-scoped termination and waits for complete process-tree exit before returning. Plugin disposal performs the same awaited cleanup without publishing late state changes.

The browser interaction follows the public Google Meet and Zoom automation approaches demonstrated by [ScreenApp's MIT-licensed meeting-bot](https://github.com/screenappai/meeting-bot), narrowed to admission and presence.

## Model Experience

### What the model sees

Nothing. The service is human-driven through the Web Remote and adds no Tool, prompt section, or session event.

### Token effect

None.

### KV Cache effect

None.

## Known Limitations and Deferred Work

- Google or Zoom may change guest pre-join markup or reject automated browsers; the driver fails with a visible code instead of falling back to a signed-in profile.
- Meetings that require platform sign-in are refused. A Zoom password is supported only when the shared link carries `pwd`; dedicated-account identity and enterprise policy support remain deferred.
- The participant is process-wide and single-job. Per-workspace ownership, persistence across Host restarts, and multiple concurrent meetings remain deferred.
- Microsoft Teams and Tencent Meeting are not accepted by this provider.
