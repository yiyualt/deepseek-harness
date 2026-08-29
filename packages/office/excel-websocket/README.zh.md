# `@deepseek-ai/dsh-office-excel-websocket`

[English](README.md) | 中文

`ctx.officeExcel` 的回环 WebSocket Provider。Excel 任务窗格连接 `/api/office-excel`，把一个存活的 Harness Session 精确绑定到工作簿，接收带关联 id 的工具调用，通过 Office.js 执行并返回无损 JSON 结果。该 Session 的新连接会替换旧连接。断开、取消、发送失败和超时都会明确结算所有等待中的调用。

默认 Origin 白名单只允许开发用 Office Add-in 宿主 `https://localhost:3010`。部署到其他来源时必须逐一列出。

## 模型体验

通过 `dsh-tool-excel` 间接影响模型；传输故障由其普通工具结果承载。

#### KV Cache 影响

Provider 不增加请求前缀；追加式工具结果不会重写先前请求 token。

## 已知限制与暂缓事项

- 绑定要求 Agent 仍然存活；任务窗格重新连接冷的持久化 Session 前，必须先通过普通 API 恢复 Session。
- 该 Provider 是本地单用户传输；除精确 Origin 白名单外，不认证远程网络客户端。
