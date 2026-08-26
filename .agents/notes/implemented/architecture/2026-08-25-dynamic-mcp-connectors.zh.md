# Agent Note: 动态 MCP 连接器分离 Host 连接与 preset 工具

Status: implemented

[English](2026-08-25-dynamic-mcp-connectors.md) | 中文

## 问题

包根入口的 [MCP 客户端桥接插件](../feature/2026-07-07-mcp-client-plugin.md)持有一个在组合期配置的服务器，并将该服务器的工具直接注册到其 Cordis 作用域。产品“连接器”面板需要不同的所有权：用户可以在 Host 持续运行时连接或断开外部帐号；凭据必须留在浏览器与模型数据之外；每个 Agent Preset 必须自行决定其 agent 是否获得这些工具。

如果把 Remote 方法、凭据存储、传输客户端和面向模型的工具放在同一个连接器插件中，帐号 UI 就会主导 MCP 运行时接口。进程级连接还会隐式扩大每个 agent 的工具集合，包括刻意保持精简的 preset。

## 决策

动态 MCP 集成是一个包含三个独立角色的能力 seam：

- [`@deepseek-ai/dsh-mcp`](../../../../packages/mcp/mcp/README.md) 是 Service Definition。`ctx.mcp` 持有具名连接请求、完整安全快照、工具目录变更事件、断开完全停稳过程和原始名称工具调用，但不暴露 SDK 客户端。
- [`@deepseek-ai/dsh-mcp-client/runtime`](../../../../packages/mcp/mcp-client/README.md#entry-points) 是 Host Service Provider。base 组合包中的单个实例持有全部动态服务器的传输 generation、凭据解析、发现、恢复与 teardown。
- [`@deepseek-ai/dsh-tool-mcp`](../../../../packages/mcp/tool-mcp/README.md) 是 Consumer。每个挂载它的 Agent Preset 都会将当前目录投影到该 preset 的 `ctx.tools` 注册表中，并通过运行时的当前 generation 解析调用。

包根入口 `@deepseek-ai/dsh-mcp-client` 仍是静态单服务器桥接插件。其直接 `ctx.tools` 注册和[有界重连监督器](../feature/2026-08-06-mcp-client-auto-reconnect.md)保留现有组合约定；动态连接器使用独立的 `./runtime` 入口。

### Host 与 preset 所有权

base 组合包挂载动态运行时，因为连接健康、凭据与传输清理是进程级 Host 关注点。`standard`、`code` 与 `cordis` preset 挂载 MCP Tool Consumer。`minimal` preset 不挂载，因此已连接帐号不会改变该 preset 面向模型的工具集合。

产品专属 Host 连接器把用户的明确意图转换成一个固定 MCP 连接，并通过其 Remote API 仅公开不含值的状态。浏览器使用已有的仅限 loopback 凭据 API 写入 secret，再调用一个无参数连接器方法。Remote 参数、快照、推送事件与诊断都绝不携带 secret。非 loopback 浏览器可以查看连接器状态，但不能更改凭据或连接状态。

产品适配器共用 `@deepseek-ai/dsh-host-mcp-connector`，处理串行化凭据检查、连接替换、安全失败投影、运行时状态对齐和等待式清理。供应商还可以要求发现后执行一次固定的只读工具调用。MCP 运行时会在发布 `connected` 前执行该激活检查，并在重连 generation 重复执行。只有验证结果为接受时才会激活目录；验证被拒绝时会先关闭初始化中的传输。供应商包继续持有自己的端点、凭据引用、服务器名、授权方案、结果分类器、失败文案、Remote 命名空间和公开事件。

即使凭据存在，连接启动后仍是断开状态。每次 Host 启动后，用户必须明确执行连接。“断开”会等待运行时 generation 与进行中的工作结算；随后，浏览器可以移除可写的当前凭据来源，而环境变量支撑的凭据仍不受浏览器控制。

### 腾讯文档空间 MCP Token 连接器

第一个连接器为 `https://docs.qq.com/openapi/mcp` 预留 `tencent_docs` 服务器名称和 `TENCENT_DOCS_MCP_TOKEN` 凭据引用。腾讯[官方 Token 教程](https://docs.qq.com/open/document/mcp/get-token/)会签发与签发时所选空间绑定的 MCP Token。这个空间 MCP Token MVP 接收该已签发值；腾讯登录、OAuth、授权同意、Token 签发、权限选择、多帐号和空间选择都不属于该连接器。

腾讯空间 MCP Token 是原始 HTTP `Authorization` 值。运行时为每个 HTTP 请求解析其凭据引用并原样发送，不添加 `Bearer `。字面量授权 header 会被拒绝。安全快照只包含状态、工具目录描述符、固定错误码和固定消息；如果服务器在工具结果中回显已解析 secret 值，运行时也会将其脱敏。

### 金山文档移出这个 seam

金山文档不再使用这条动态 MCP 路径。其官方 CLI 持有浏览器授权、系统钥匙串存储与文档操作；替代集成由[通过官方 CLI 登录金山文档](2026-08-26-kingsoft-docs-cli-browser-login.md)规定。通用 MCP seam 与腾讯文档连接器保持不变。

### 工具身份与批准

Consumer 保留既有的 `mcp__<serverName>__<rawName>` 公开名称约定，并通过 `ctx.mcp` 调用原始工具名称。工具目录替换在每个 preset 作用域内保持原子性；无效 schema 或注册冲突无法发布部分 generation。

远端 annotation 是不受信任的服务器输入，绝不会降低批准要求。对于每个可执行 MCP 工具，Consumer 都会在执行器内部、紧邻 `ctx.mcp.callTool` 之前请求批准，并使用 `MCP tool may change external data` 作为理由；工具流水线中更早的决策无法绕过这项 last-mile 检查。只有 `allowed-once` 能到达传输层。缺少 approval 服务、调用缺少 agent，以及任何非 grant 结果都会关闭式失败。未来若要免除确认，必须使用与远端 annotation 无关、由 Host 持有并经过审查的 allowlist 或策略；服务器元数据本身绝不能授予豁免。

## 曾考虑的替代方案

**为静态包根桥接插件添加产品 Remote 与 UI 状态。** 否决：静态插件刻意把一个已配置传输与直接工具注册结合在一起。动态帐号生命周期和 preset 专属可见性需要独立所有者与可独立测试的失败行为。

**由 Host 提供方全局注册所有已连接工具。** 否决：传输所有权属于进程级，而工具可见性是 Agent Preset 决策。全局注册会让一个 UI 操作扩大无关 agent 与 minimal agent 的能力范围。

**把 Token 传给连接器 Remote 方法。** 否决：RPC 参数是可观测的应用数据，会扩大 secret 的存续时间与暴露范围。凭据服务已经提供仅限 loopback 的写入路径，以及供运行时消费方使用的不透明引用。

**只要存在已存储 Token 就自动连接。** 否决：凭据只能证明可以使用，不能证明用户当前有意联系外部服务或暴露其工具目录。明确连接也让重启行为与故障恢复可见。

**公开连接器前先实现腾讯 OAuth。** 暂缓：空间 MCP Token 提供了验证 MCP 产品路径所需的最小凭据。OAuth 会增加浏览器重定向、授权同意、刷新、吊销与帐号选择，属于独立授权决策。

**使用远端 `readOnlyHint` annotation 绕过确认。** 否决：远端服务器控制所有 annotation，并可随工具实现一起虚假声明或更改它。所有可执行 MCP 工具使用相同的执行器自有批准路径；未来的任何豁免都来自单独审查的 Host 策略。

**只通过 `tools/pre-execute` 请求确认。** 否决：更早的监听器可以返回 `allow`，并使后续策略监听器短路。批准必须位于 MCP 执行器内部并紧邻外部调用，确保每条执行路径都经过它。

## 验证

Service Definition 与 Consumer 测试套件固定快照 revision、限定作用域的工具目录替换、名称稳定性、当前 generation 调度、dispose、远端安全 annotation 为 true、false 或缺失时由执行器持有的批准、对早期 `allow` 的抵抗，以及缺服务、缺 agent、拒绝、取消和不可用结果的关闭式失败。提供方的无密钥 Streamable HTTP 集成覆盖 raw 与 Bearer 授权、分页发现、后续请求中的凭据轮换、回显 secret 脱敏、安全认证失败与断开。共享生命周期、腾讯和浏览器控制器测试固定不含 secret 的 Remote 接口、明确连接、loopback 更改栅栏、可写来源删除和只读远端视图。

## 后果

- 新增其他 MCP 产品连接器只需要轻量 Host 适配器与 UI 贡献项，不需要新的 MCP 协议实现、生命周期副本或工具注册表路径。
- 已连接工具目录只在挂载 Consumer 的 preset 中改变模型工具 schema。工具名称、描述和 JSON Schema 会增加请求 token，并可能使从首个变化的 schema token 开始的 KV Cache 复用失效。
- Host 可以轮换或吊销凭据而不公开其值。下一次 HTTP 请求会解析变更后的 raw 或 Bearer 凭据；连接器不缓存授权 header。
- 只读 MCP 操作仍然需要由执行器持有的 last-mile 批准。若要消除这种操作阻力，必须采用经过审查的 Host 策略，不能把服务器控制的 annotation 作为授权依据。
- 空间 MCP Token MVP 刻意保留腾讯 OAuth 与多帐号身份问题。支持这些能力时应新增凭据与连接器状态，而不是弱化 raw Token 语义。
- MCP resources、prompts 与需要 task 的执行仍不属于 Tool Consumer。
