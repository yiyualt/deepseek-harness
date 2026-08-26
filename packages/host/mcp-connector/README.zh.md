# `@deepseek-ai/dsh-host-mcp-connector`

[English](README.md) | 中文

这是由用户管理的 Streamable HTTP MCP 连接器所共用的 Host 生命周期。供应商包提供固定端点、凭据引用、本地服务器名、授权方案、安全失败文案，以及可选的发现后验证调用。`McpConnectorLifecycle` 负责串行化连接、重试、断开、凭据刷新、运行时状态对齐、公开状态和清理，但自身不创建 Remote 命名空间。

凭据值始终留在 `ctx.credentials` 后面。连接请求只包含不透明的凭据引用和 `raw` 或 `bearer` 授权方案。完整快照包含凭据是否可用、来源和可写性，但绝不包含凭据值。公开快照会省略全部凭据元数据。Provider 诊断在进入任何快照前都会被收敛为供应商自有的固定失败信息。

可选连接检查会在 MCP 初始化和完整工具发现完成后、运行时发布 `connected` 前执行。供应商选择一个只读工具、固定 JSON 参数、超时时间和结果分类器。只有 `accepted` 才会激活已发现目录。认证被拒绝或响应不可用时，会先关闭初始化中的 MCP 传输，再发布失败状态；重连 generation 会重复同一检查。

## Model Experience

### 连接器生命周期

#### What the model sees

模型不会从本包直接看到任何内容。供应商连接器请求进程级 MCP 连接，独立的 `dsh-tool-mcp` Consumer 决定哪些 agent preset 获得其工具。

#### Token effect

本包不添加 prompt 或工具 token。连接后的服务器目录通过 Consumer 消耗 token。

#### KV Cache effect

生命周期快照本身不影响缓存。连接或断开可能改变后续模型请求的工具 schema 前缀。

## Known Limitations and Deferred Work

- 一个生命周期实例只管理一个固定端点、服务器名和凭据引用。
- 连接意图只保存在内存里；每次 Host 重启后都从未连接开始。
- OAuth、账号选择和 Token 签发仍由各供应商负责。
