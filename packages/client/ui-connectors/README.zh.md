# `@deepseek-ai/dsh-client-ui-connectors`

[English](README.md) | 中文

这个 Web 客户端插件向 `sidebar.footer.action` 贡献“连接器”操作。模态面板会渲染 Host 自有 `mcpConnectors` 目录返回的全部 Token 认证托管 MCP 产品，然后显示独立的金山文档和个人 QQ 邮箱卡片。产品名称、说明、凭据标签、设置链接、生命周期状态与工具数量都来自通用 MCP 目录；新增一条 MCP 产品配置无需新增浏览器组件。金山文档仍是 CLI 适配器，个人 QQ 邮箱则使用提供方专属的 IMAP/SMTP 凭据。

在 loopback 页面上，托管 MCP 控制器只会收到每个提供方的不透明凭据引用，以及安全的 `configured`、`source` 和 `writable` 元数据。新输入值只会单向经过 `credentials.set`，并且在 `connect(id)` 前从浏览器状态清除。断开操作先停止所选连接，再调用 `credentials.unset`；如果生效来源只读，则跳过删除。金山文档卡片启动 `kdocs-cli auth login`。QQ 邮箱卡片通过同一个单向凭据 API 保存 `@qq.com` 地址和 IMAP/SMTP 授权码；授权码不是 QQ 密码。非 loopback 页面只调用安全的公开状态方法，不能修改凭据或连接。

界面使用稳定的连接器失败码选择中文或英文文案；仅对未知失败码显示 Host `errorMessage`。如果连接器 RPC 失败，并且对应的 `connecting` 或 `disconnecting` 状态在 carrier 失败前后到达，控制器会提交本地且可重试的 `CLIENT_REQUEST_FAILED` 状态，避免面板一直处于忙碌状态。没有对应过渡状态的请求会保留 Host 的上一个终态，并单独报告本地 carrier 错误；后续不匹配的 Host 状态会清除这项待确认关联。

## 模型体验

### 连接器管理

#### 模型看到什么

这个 UI 包本身不会向模型提供任何内容。Host MCP 集成与提供方专属 Consumer 分别拥有加入后续模型请求的工具，包括 `kingsoft_docs_*` 和 `qq_mail_*`。

#### Token 影响

面板本身不增加 token。已连接的 Host 集成所暴露的工具 schema 会单独占用模型请求 token。

#### KV Cache 影响

打开或关闭面板没有影响。连接或断开可能改变 Host 的工具清单，从而改变可缓存的请求前缀。

## 已知限制与暂缓工作

- 托管 MCP 卡片目前支持手工取得的 raw 或 Bearer Token。OAuth 提供方需要独立授权适配器。
- 金山浏览器认证要求 Host 已安装官方 `kdocs-cli`。
- 个人 QQ 邮箱要求在 QQ 邮箱设置中开启 IMAP/SMTP 并生成授权码。
- 非 loopback 部署必须先有独立且经过认证的凭据管理设计，才能开放变更操作。
