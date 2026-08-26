# `@deepseek-ai/dsh-host-mcp-connector`

[English](README.md) | 中文

这是由用户管理的 Streamable HTTP MCP 连接器所共用的进程级网关与生命周期。`connectors` 配置可以声明任意数量采用 Token 认证的产品，包括端点、凭据引用、本地服务器名、raw 或 Bearer 授权方式，以及双语卡片元数据。`mcpConnectors` Remote 通过 `list`、`publicList`、`connect(id)` 和 `disconnect(id)` 暴露一个动态目录。新增兼容提供方只需修改部署配置，不需要新增 Remote 命名空间或浏览器组件。

每条配置对应一个 `McpConnectorLifecycle`，负责串行化连接、重试、断开、凭据刷新、运行时状态对齐、公开状态和清理。连接器 id、服务器名与凭据引用必须唯一。端点和凭据帮助链接必须使用 HTTPS；无效或重复配置会在插件激活时失败。

凭据值始终留在 `ctx.credentials` 后面。连接请求只包含不透明的凭据引用和 `raw` 或 `bearer` 授权方案。完整快照包含凭据是否可用、来源和可写性，但绝不包含凭据值。公开快照会省略全部凭据元数据。Provider 诊断在进入任何快照前都会被收敛为供应商自有的固定失败信息。

完整 loopback 目录包含安全的凭据可用性、来源、可写性，以及现有只写凭据 API 所需的不透明凭据引用。`publicList` 和 `mcp-connectors/change` 会省略全部凭据字段。展示文案与链接是部署方拥有的公开元数据；两个目录都不包含端点、授权方式或凭据值。

## Model Experience

### 连接器生命周期

#### What the model sees

模型不会从本包直接看到任何内容。供应商连接器请求进程级 MCP 连接，独立的 `dsh-tool-mcp` Consumer 决定哪些 agent preset 获得其工具。

#### Token effect

本包不添加 prompt 或工具 token。连接后的服务器目录通过 Consumer 消耗 token。

#### KV Cache effect

生命周期快照本身不影响缓存。连接或断开可能改变后续模型请求的工具 schema 前缀。

## Known Limitations and Deferred Work

- 声明式目录支持采用 Token 认证的 Streamable HTTP MCP。OAuth 跳转、刷新凭据、帐号选择与本地 CLI 集成仍需要独立适配器。
- 连接意图只保存在内存里；每次 Host 重启后都从未连接开始。
- OAuth、账号选择和 Token 签发仍由各供应商负责。
