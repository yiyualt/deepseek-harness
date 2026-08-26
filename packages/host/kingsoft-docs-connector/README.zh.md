# `@deepseek-ai/dsh-host-kingsoft-docs-connector`

[English](README.md) | 中文

这是官方金山文档 [`kdocs-cli`](https://github.com/kdocs-app/kdocs-skill) 的 Web Host 集成。`kingsoftDocsConnector` Remote 把 loopback 页面上的明确用户操作转换为 `kdocs-cli auth login`，由它打开用户的默认浏览器。CLI 把认证信息保存在操作系统钥匙串中；浏览器、Remote 载荷、Harness 凭据存储、模型和会话日志都不会收到已保存的值。

本包同时拥有必须随供应商一起演进的两部分：包根目录中的进程级网页登录与子进程生命周期，以及 `./tool` 中可选的 preset 级工具 Consumer。standard、code 和 Cordis preset 会挂载该 Consumer。它只在网关报告 `connected` 时注册工具；minimal preset 不会获得这些工具。

连接前请按照[金山文档安装与认证说明](https://github.com/kdocs-app/kdocs-skill/blob/master/references/auth.md)安装官方 CLI。`command` 默认是 `kdocs-cli`，也可以在 overlay 中配置为绝对可执行文件路径。本连接器支持个人账号 CLI；WPS 企业账号需要使用供应商文档所指向的 WPS 365 集成。

## Remote API

| 方法 | 输入 | 结果 |
|---|---|---|
| `get` | 无 | loopback 页面使用的当前登录生命周期状态。 |
| `publicGet` | 无 | 可信非 loopback 页面使用的同一份无凭据状态。 |
| `connect` | 无 | 复用有效钥匙串登录，或者打开浏览器授权并验证结果。 |
| `disconnect` | 无 | 等待活跃调用结束后，通过 `kdocs-cli auth logout` 移除已保存登录。 |

`get`、`connect` 和 `disconnect` 仅限 loopback。`publicGet` 与 `kingsoft-docs-connector/change` 只暴露状态、工具数量、稳定安全的失败信息和更新时间。失败码包括 `CLI_NOT_FOUND`、`CLI_INCOMPATIBLE`、`LOGIN_FAILED`、`LOGIN_TIMEOUT`、`AUTH_REJECTED` 和 `DISCONNECT_FAILED`。

每个子进程都通过 `ctx.subprocess` 执行，并显式指定可执行文件、参数向量、工作目录、环境、流上限、截止时间和进程树终止宽限期。操作参数以一个 JSON 对象通过 stdin 传递。service 名称、action 名称和用户数据都不会经过 shell 解析。每个子进程都会移除旧的 `KINGSOFT_DOCS_TOKEN` 环境变量，避免它绕过浏览器与钥匙串认证。

## 模型体验

### 已连接的金山文档工具

#### 模型看到什么

这个 preset 级 Consumer 暴露两个稳定工具，不会把 CLI 持续变化的 action 目录完整复制到模型请求中：`kingsoft_docs_help` 读取当前 CLI 帮助而不执行文档 API 操作，`kingsoft_docs_call` 则会在得到一次本地审批后，以 JSON 参数执行一个受支持的 service/action。允许的 service 是 `drive`、`sheet`、`otl`、`dbsheet`、`form`、`wpp`、`aippt`、`wps`、`pdf` 和 `kwiki`。action 名称必须是 kebab-case，并且应来自 `kingsoft_docs_help`，而不是模型记忆。模型还会收到规则：不可逆的 delete/close 操作必须先向用户明确确认，写操作必须通过独立读取验证。

#### Token 影响

两个固定 schema 形成稳定的请求前缀。只有实际调用相应工具时，CLI 帮助或操作结果才会进入上下文。

#### KV Cache 影响

登录和退出会在相关 preset 的下一次请求中加入或移除同样的两个工具 schema。连接器状态本身不会对模型可见。

## 已知限制与后续工作

- `kdocs-cli` 是外部前置条件，Harness 进程不会自动下载或升级它。
- 登录意图不会持久化。Host 重启后从未连接状态开始，即使钥匙串条目仍有效；点击“网页登录”会直接复用并验证它，而不会再次打开页面。
- 一个进程级登录由所有已连接会话共享。暂不支持账号选择或同时使用多个个人账号。
- 工具 schema 有意描述稳定的通用桥，而不是供应商的每个 action。当前 action 参数以已安装 CLI 的帮助输出为准。
