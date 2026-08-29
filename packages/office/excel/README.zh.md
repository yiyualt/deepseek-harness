# `@deepseek-ai/dsh-office-excel`

[English](README.md) | 中文

工作簿执行能力的 Service Definition。`ctx.officeExcel` 接受一个传输 Provider，并把 JSON 操作路由到与调用方 Harness Session 绑定的工作簿。Provider 缺失或工作簿断开时，会用稳定的 `OfficeExcelError` 错误码失败；该服务绝不会猜测“当前工作簿”。

## 模型体验

通过 `dsh-tool-excel` 间接影响模型；该 Consumer 拥有模型可见的 schema 与结果。

#### KV Cache 影响

该服务不增加请求内容；Consumer 拥有稳定的工具 schema 前缀和追加式结果。

## 已知限制与暂缓事项

- 一个 Context 中只能启用一个传输 Provider；尚未定义 Provider 故障切换。
