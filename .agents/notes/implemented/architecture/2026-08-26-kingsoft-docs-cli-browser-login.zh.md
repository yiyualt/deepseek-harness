# Agent Note: 金山文档网页登录委托给官方 CLI

Status: implemented

[English](2026-08-26-kingsoft-docs-cli-browser-login.md) | 中文

## 问题

第一版金山文档连接器要求个人 Token，并把供应商托管端点当作动态 MCP 服务器。该路径要求用户获取并粘贴凭据，而供应商当前集成已经提供 `kdocs-cli auth login`：它会打开浏览器授权引导页，并把得到的认证信息持久化到操作系统钥匙串。

继续保留托管 MCP 适配器会形成两个互相竞争的认证所有者：Harness 凭据存储与 MCP 运行时持有一个 Token，官方 CLI 与钥匙串持有另一个 Token。产品还会绑定到远端目录，而其 action 名称与认证行为可以脱离官方 CLI 版本独立变化。

## 决策

[`@deepseek-ai/dsh-host-kingsoft-docs-connector`](../../../../packages/host/kingsoft-docs-connector/README.md) 是供应商专属的网页登录与 CLI 网关，不是 MCP 适配器。其进程级包根入口持有 `kdocs-cli` 子进程生命周期与 `kingsoftDocsConnector` Remote；`./tool` 入口持有调用同一已认证网关的 preset 作用域模型工具。

loopback 页面上的明确连接操作先运行 `kdocs-cli auth status --compact`。如果不存在有效钥匙串登录，则运行 `kdocs-cli auth login` 并在配置预算内等待，随后再次检查状态，确认成功后才发布 `connected`。“退出登录”会立即移除工具目录，等待进行中的调用结束，运行 `kdocs-cli auth logout`，再验证认证已不存在。浏览器参数、Remote 快照、公开变更事件、模型输入与 session 事件都不包含已保存凭据。受信任的非 loopback 页面可以读取不含凭据的状态，但不能开始或移除认证。

网关通过 `ctx.subprocess` 调用 CLI，使用明确的可执行文件与参数向量，不经过 shell，并限制 stdin 与输出大小，传播调用方取消，设置 deadline 与进程树终止宽限。文档 action 参数作为一个完整 JSON 对象通过 stdin 传递，并使用 CLI 的 `-` 输入标记。每个子进程都会移除旧版 `KINGSOFT_DOCS_TOKEN` 环境变量，避免环境状态绕过浏览器与钥匙串认证。

standard、code 与 Cordis preset 在网关已连接时挂载两个稳定工具；minimal preset 不挂载。`kingsoft_docs_help` 读取已安装 CLI 的帮助，使模型发现当前 service、action 与参数名称。`kingsoft_docs_call` 接受固定 service 枚举、kebab-case action 与一个 JSON 参数对象，并在每次已认证操作前请求本地单次批准。其模型描述还要求：不可逆 delete 或 close 操作需要用户明确确认，写操作完成后需要独立读取验证。

连接器不会下载或升级供应商二进制。运维人员安装官方 `kdocs-cli`，并可在组合中覆盖可执行文件路径。供应商记录的个人帐号限制保持可见；WPS 企业帐号使用供应商的 WPS 365 集成。

## 曾考虑的替代方案

**保留托管 MCP Token 连接器。** 否决：它会复制供应商当前的认证所有者，继续让浏览器处理凭据输入，并依赖托管目录而不是 Host 上安装的官方 CLI 版本。

**在“连接器”面板公开 `auth set-token`。** 否决：手动 Token 输入仅作为供应商文档中的恢复路径保留。正常产品旅程是浏览器授权，浏览器不能处理得到的凭据。

**为每个 CLI action 注册一个 Harness 工具。** 否决：供应商目录会随 CLI 版本变化，并会给每次模型请求增加庞大且不稳定的 schema 前缀。help 与 call 两个工具保持模型名称稳定，并以已安装 CLI 为权威。

**由连接器安装或升级 CLI。** 否决：可执行文件获取与供应链策略属于部署。连接器报告稳定的 `CLI_NOT_FOUND` 或 `CLI_INCOMPATIBLE` 状态，并链接供应商安装指南。

**对描述为读取的 action 跳过批准。** 否决：一个通用 action 桥不能把模型提供的 action 名称当成可信策略。每个已认证调用使用同一项 last-mile 批准；不可逆操作还需要任务层面的明确确认。

## 验证

Host 测试覆盖登录复用、网页登录、退出登录、钥匙串状态验证、命令构造、stdin JSON、旧环境变量移除、每个安全失败码、输出与输入上限、调用方取消、超时、进程失败、登录和退出期间的 teardown、进行中调用排空、目录激活、批准结果与工具释放，并达到语句、分支、函数和行 100% 覆盖。Client 测试覆盖互相独立的腾讯与金山卡片、loopback 更改栅栏、公开只读状态、本地化失败、carrier 竞态、晚到结算，以及登录、重试、忙碌与退出状态，并达到相同覆盖率。组装后的 Web replay 使用本地假 `kdocs-cli`，执行网页登录状态流，确认两个 schema 进入无密钥模型请求，批准一次 action，记录 CLI 结果到对话，并验证退出登录。

## 后果

- 金山文档认证表现为网页登录生命周期，不再表现为凭据字段或 MCP 目录数量。
- 有效钥匙串登录可跨 Host 重启保留，但连接器启动时仍为断开；下一次明确点击“网页登录”会复用并验证它。
- 连接后，standard、code 与 Cordis preset 中的模型恰好获得两个金山工具 schema。CLI 帮助和 action 结果仅在对应工具调用后进入上下文，并保持可从 session 日志重建。
- 一个进程级个人帐号登录由所有 session 共享。帐号选择与同时使用多个帐号尚未实现。
- CLI 安装与供应商版本兼容性是部署前置条件，不是连接器隐式执行的更改。
- 动态 MCP seam 继续作为腾讯文档集成路径，不再把金山文档列为 Consumer。
