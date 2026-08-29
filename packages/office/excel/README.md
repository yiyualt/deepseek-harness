# `@deepseek-ai/dsh-office-excel`

English | [中文](README.zh.md)

Service Definition for workbook execution. `ctx.officeExcel` accepts one transport provider and routes a JSON operation to the workbook bound to the calling Harness Session. A missing provider and a disconnected workbook fail with stable `OfficeExcelError` codes; the service never guesses an active workbook.

## Model Experience

Indirectly, through `dsh-tool-excel`, which owns the model-visible schemas and results.

#### KV Cache effect

The service adds no request content; the Consumer owns its stable tool-schema prefix and append-only results.

## Known Limitations and Deferred Work

- One transport provider may be active in a Context; provider failover is not defined.
