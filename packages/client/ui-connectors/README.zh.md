# `@deepseek-ai/dsh-client-ui-connectors`

[English](README.md) | 中文

这个 Web 客户端插件向 `sidebar.footer.action` 贡献“连接器”操作。模态面板包含相互独立的腾讯文档与金山文档卡片，分别由 Host 拥有的 `tencentDocsConnector` 和 `kingsoftDocsConnector` Remote 支撑。腾讯卡片渲染生命周期状态、无值凭据元数据、已发现的工具数量和有界失败信息。金山卡片渲染不含凭据的网页登录生命周期与工具数量。插件订阅两个公开 change 事件。打开面板时，会通过各连接器的 loopback `get` 或无凭据 `publicGet` Remote 补齐错过的状态。较新的 push 或已完成变更会使较早的打开面板刷新失效；连接或断开完成后，其晚到的过渡前置状态也会被拒绝。`updatedAt` 不被当作排序 revision。

腾讯使用 `TENCENT_DOCS_MCP_TOKEN`。在 loopback 页面上，其控制器通过 `credentials.describe` 只获知 `configured`、`source` 和 `writable`；面板打开期间，匹配的 `credentials/updated` 事件会开始一次有序读取。新输入的 Token 只会单向经过 `credentials.set`，并且在调用 Remote 前便从浏览器状态清除。断开操作先停止腾讯连接器，再调用 `credentials.unset`；如果生效来源只读，则跳过删除。金山没有 Token 输入框，也不会调用凭据 API：点击“网页登录”会要求 Host 启动 `kdocs-cli auth login`，点击“退出登录”会要求 Host 移除钥匙串登录。界面永远不会收到任一供应商已保存的凭据。非 loopback 页面严格只读：只调用各自的非特权 `publicGet` Remote，不会调用凭据方法或 `get`、`connect`、`disconnect`。

界面使用稳定的连接器失败码选择中文或英文文案；仅对未知失败码显示 Host `errorMessage`。如果连接器 RPC 失败，并且对应的 `connecting` 或 `disconnecting` 状态在 carrier 失败前后到达，控制器会提交本地且可重试的 `CLIENT_REQUEST_FAILED` 状态，避免面板一直处于忙碌状态。没有对应过渡状态的请求会保留 Host 的上一个终态，并单独报告本地 carrier 错误；后续不匹配的 Host 状态会清除这项待确认关联。

## 模型体验

### 连接器管理

#### 模型看到什么

这个 UI 包本身不会向模型提供任何内容。腾讯的 Host MCP 集成与金山的 preset 级 CLI Consumer 分别拥有加入后续模型请求的工具，包括 `kingsoft_docs_help` 和 `kingsoft_docs_call`。

#### Token 影响

面板本身不增加 token。已连接的 Host 集成所暴露的工具 schema 会单独占用模型请求 token。

#### KV Cache 影响

打开或关闭面板没有影响。连接或断开可能改变 Host 的工具清单，从而改变可缓存的请求前缀。

## 已知限制与暂缓工作

- 面板包含两个内置文档连接器，没有动态连接器目录。
- 腾讯认证使用手工获取的空间 MCP Token。金山浏览器认证要求 Host 已安装官方 `kdocs-cli`。
- 非 loopback 部署必须先有独立且经过认证的凭据管理设计，才能开放变更操作。
