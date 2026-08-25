# `@deepseek-ai/dsh-client-ui-connectors`

[English](README.md) | 中文

这个 Web 客户端插件向 `sidebar.footer.action` 贡献“连接器”操作。该操作会打开一个模态面板，其中第一张卡片通过 Host 拥有的 `tencentDocsConnector` Remote 管理腾讯文档 MCP 连接器。在 loopback 页面上，卡片渲染完整的 Remote 快照，包括生命周期状态、凭据元数据、已发现的工具数量以及有界失败消息。插件订阅不含凭据元数据的 `tencent-docs-connector/change` 事件，并在不清除本地已知凭据元数据的前提下合并这些公开生命周期字段。打开面板时，会通过 loopback 上的完整 `get` 或不含凭据字段的 `publicGet` Remote 补齐错过的状态。较新的 push 或已完成变更会使较早的打开面板刷新失效；连接或断开完成后，其晚到的过渡前置状态也会被拒绝。`updatedAt` 不被当作排序 revision。

空间 MCP Token 使用固定的 `TENCENT_DOCS_MCP_TOKEN` 凭据引用。在 loopback 页面上，控制器通过 `credentials.describe` 只获知 `configured`、`source` 和 `writable`；面板打开期间，仅当转发的 `credentials/updated` 事件指向该引用时，才会开始一次新的有序读取，并且只有最新读取可以更新卡片。新输入的 Token 只会单向经过 `credentials.set`，并且在调用连接器 Remote 前便从浏览器状态清除。断开操作先停止连接器，再调用 `credentials.unset`；如果生效的凭据来源只读，则跳过删除。界面永远不会收到已存储的 Token。面板关闭后，凭据失效事件不会触发重新读取。非 loopback 页面严格只读：只调用非特权 `publicGet` Remote 获取安全的当前快照，不会订阅凭据失效事件，也不会调用凭据方法或 `get`、`connect`、`disconnect`。

界面使用稳定的连接器失败码选择中文或英文文案；仅对未知失败码显示 Host `errorMessage`。如果连接器 RPC 失败，并且对应的 `connecting` 或 `disconnecting` 状态在 carrier 失败前后到达，控制器会提交本地且可重试的 `CLIENT_REQUEST_FAILED` 状态，避免面板一直处于忙碌状态。没有对应过渡状态的请求会保留 Host 的上一个终态，并单独报告本地 carrier 错误；后续不匹配的 Host 状态会清除这项待确认关联。

## 模型体验

### 连接器管理

#### 模型看到什么

这个 UI 包本身不会向模型提供任何内容。`tencentDocsConnector.connect` 成功后，Host 的 MCP 集成可以把连接器发现的工具添加到后续模型请求中。

#### Token 影响

面板本身不增加 token。已连接的 Host 集成所暴露的工具 schema 会单独占用模型请求 token。

#### KV Cache 影响

打开或关闭面板没有影响。连接或断开可能改变 Host 的工具清单，从而改变可缓存的请求前缀。

## 已知限制与暂缓工作

- 面板仅包含一张腾讯文档卡片，没有连接器目录。
- 认证仅支持手工获取的空间 MCP Token；这里尚未实现 OAuth 浏览器流程。
- 非 loopback 部署必须先有独立且经过认证的凭据管理设计，才能开放变更操作。
