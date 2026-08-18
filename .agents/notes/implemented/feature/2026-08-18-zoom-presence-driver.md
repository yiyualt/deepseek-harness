# Agent Note: Zoom presence driver

Status: implemented

English | [中文](2026-08-18-zoom-presence-driver.zh.md)

## Problem

The process-owned meeting participant initially recognizes only Google Meet links and markup. Accepting Zoom links without a separate driver would either navigate an unsupported page with Google selectors or turn the Remote into an unrestricted browser launcher.

## Decision

The `meetingPresence` Host service recognizes canonical Zoom `/j/<meeting-id>` and `/wc/join/<meeting-id>` links on `zoom.us` subdomains. Validation retains only the optional `pwd` query value. A validated Zoom target selects a separately packaged Playwright worker that opens the Zoom Web Client, enters the disclosed participant name, submits the Join action, reports waiting and joined states through the existing worker protocol, and remains present until removal or an explicit leave.

The Zoom driver shares the Google driver's process ownership, single-active-participant rule, scrubbed child environment, bounded diagnostics, and complete-tree teardown. It contains no recording, transcription, screenshot upload, object storage, or durable meeting state.

The browser interaction is informed by [ScreenApp's MIT-licensed Zoom bot](https://github.com/screenappai/meeting-bot/blob/main/src/bots/ZoomBot.ts). The driver retains Web Client navigation, top-level-or-iframe detection, guest-name entry, and admission observation; recording, upload, queue, and notification behavior remain outside the package.

## Alternatives considered

**Send Zoom links to the Google worker.** Rejected because the platforms use different URL forms, pre-join controls, iframe behavior, admission signals, and meeting-end indicators.

**Run the complete ScreenApp service.** Rejected because its successful path records and uploads meeting media, while this capability promises presence only.

**Accept arbitrary Zoom paths and query fields.** Rejected because unrelated paths would widen the service into general navigation and unrelated query fields are not required for guest admission.

## Consequences

The Meetings panel accepts Google Meet and Zoom links while retaining one Host-owned lifecycle. A Zoom meeting that requires a password succeeds only when the shared link carries `pwd`; sign-in, CAPTCHA, enterprise policy, and external UI changes remain explicit failure cases. Real admission still requires a live host to allow the disclosed participant.
