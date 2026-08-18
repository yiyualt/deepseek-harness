# Agent Note: Google Meet presence spike

Status: implemented

English | [中文](2026-08-18-google-meet-presence-spike.zh.md)

## Problem

The Web application has no path for a user to submit a meeting link and observe a Harness-owned participant inside the meeting. Building recording, transcription, storage, multi-provider routing, and account identity before proving admission would combine independent failure domains and would record meeting content before that behavior has a reviewed purpose.

## Decision

The Web bundle mounts one process-wide `meetingPresence` Host service and one `ui-meeting` sidebar contribution. The first provider accepts only canonical Google Meet links and starts a packaged Playwright worker through the existing subprocess service. The worker uses a fresh Chrome context, enters the disclosed name `DeepSeek AI 会议助手`, requests guest admission, and remains present without recording, transcribing, taking meeting screenshots, or uploading meeting content.

The Host owns the participant lifecycle and publishes complete snapshots for `starting`, `waiting-admission`, `joined`, `leaving`, `left`, and `failed`. The Web Remote forwards those snapshots to the panel; opening the panel also reads the current snapshot so reconnects and closed panels converge without polling. Only one participant may exist per Host process.

Google Meet URL validation occurs before process creation and accepts only `https://meet.google.com/xxx-xxxx-xxx`. Browser execution receives the subprocess provider's scrubbed ambient environment. User-requested leave and plugin disposal both terminate the complete browser process tree and await quiescence.

The browser interaction is informed by [ScreenApp's MIT-licensed meeting-bot](https://github.com/screenappai/meeting-bot), but the delivered worker retains only guest admission and presence. It does not import ScreenApp's recording, uploader, Redis, storage, backend-token, or stealth-name behavior.

## Alternatives considered

**Run ScreenApp meeting-bot unchanged.** Rejected because its successful join path records the meeting and later attempts an upload; missing storage credentials prevent delivery, not capture.

**Implement recording and transcription in the first slice.** Rejected because visible admission is the first independent product fact. Capture consent, media transport, retention, and transcript durability need their own decision after admission works reliably.

**Start with Tencent Meeting.** Rejected for this spike because the researched `tmeet` CLI manages meetings and artifacts but does not create a visible live participant, while the reference implementation provides a concrete Google Meet guest path.

**Allow arbitrary meeting URLs.** Rejected because the worker would become a general browser navigation endpoint and because its selectors are specific to Google Meet.

## Consequences

Users get a small end-to-end surface: open Meetings, submit a Google Meet link, admit the disclosed participant, observe its joined state, and make it leave. The slice proves UI-to-Remote-to-managed-browser ownership without creating meeting recordings or durable session facts.

The Google driver depends on Google Meet's guest markup and an installed Chrome channel, so external UI changes can still break admission. The same lifecycle also hosts the [Zoom presence driver](2026-08-18-zoom-presence-driver.md). Meetings requiring sign-in, dedicated bot accounts, Teams, Tencent Meeting, concurrency, persistence, and any media processing remain absent by design.
