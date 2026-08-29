# DSH Office Add-in

English | [中文](README.zh.md)

Microsoft Excel task pane for DeepSeek Harness. The page uses the existing DSH Session HTTP API and WebSocket mux for chat, then binds that Session to the current workbook through `dsh-office-excel-websocket`. Office.js remains inside Excel's task-pane runtime; the Harness process never attempts to automate Excel directly.

## Development

```sh
pnpm run build
pnpm dsh web --port 3080
pnpm --filter @deepseek-ai/dsh-office-addin sideload:mac
pnpm --filter @deepseek-ai/dsh-office-addin dev
```

The first `dev` run installs and asks macOS to trust a localhost development certificate. Restart Excel after sideloading, then open **Home > Add-ins > DeepSeek Harness for Excel**. The development server listens at `https://localhost:3010` and proxies `/api` plus WebSocket upgrades to `http://127.0.0.1:3080`; set `DSH_OFFICE_HARNESS_URL` when the Harness Web port differs.

The task pane supports workbook inspection, worksheet creation, bounded range reading, literal rectangular writes, clearing, and insertion of chart objects from existing source ranges. Every mutation returns Office.js read-back data.

## Model Experience

The task pane contributes no model schema itself. The `dsh-tool-excel` Consumer supplies six Excel tools; this app executes only invocations addressed to its bound Harness Session.

#### Token effect

None beyond chat messages and the tool schemas owned by `dsh-tool-excel`.

#### KV Cache effect

The stable tool schemas join the request prefix; chat, calls, and results append to the conversation tail.

## Known Limitations and Deferred Work

- Development sideloading currently has a macOS helper; Windows sideload automation is deferred.
- Chart restyling, series editing, deletion, and image export are deferred.
- Formula authoring, formatting, tables, pivots, worksheet rename/delete/reorder, and large-range pagination are deferred.
