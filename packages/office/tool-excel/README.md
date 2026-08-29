# `@deepseek-ai/dsh-tool-excel`

English | [中文](README.zh.md)

Model-facing Consumer for the Excel capability. It registers workbook inspection, worksheet creation, range read/write/clear, and chart insertion tools; every call routes by the calling Agent's Session id and therefore never selects a process-global active workbook. Mutations return Office.js read-back data rather than assuming success from a mutation call.

## Model Experience

### Workbook tools

#### What the model sees

Six native tool schemas—`excel_inspect`, `excel_read_range`, `excel_write_range`, `excel_clear_range`, `excel_create_worksheet`, and `excel_insert_chart`—with bounded A1 ranges and an instruction to inspect unknown workbook structure before editing. Worksheet creation enables isolated analysis and dashboard output without overwriting source data. Chart insertion supports clustered column, clustered bar, line, pie, area, doughnut, and scatter objects with an explicit source and destination. Their generated definitions are recorded in the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-excel). Results are structured JSON rendered as text. A task pane disconnect becomes a normal tool failure that tells the model and user to reopen the Excel connection.

#### Token effect

Six tool schemas per request, plus data-dependent JSON results only when called.

#### KV Cache effect

The stable schemas join the system prompt. Tool calls and results append to the conversation tail.

## Known Limitations and Deferred Work

- Chart insertion creates and positions a new object from an existing range; chart restyling, series editing, deletion, and image export are deferred.
- Formula authoring, formatting, tables, pivots, worksheet rename/delete/reorder, and large-range pagination are deferred.
- Tools are visible to every Agent in a composition that mounts this Consumer; execution still requires a task pane bound to that exact Session.
