# @deepseek-ai/dsh-mcp-client

[English](README.md) | 中文

用于连接外部 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器的 MCP 客户端传输实现。包根入口是一个静态、单服务器桥接插件，直接注册到 `ctx.tools`；`@deepseek-ai/dsh-mcp-client/runtime` 是 Host 持有的动态 `ctx.mcp` 连接提供方，只向限定在 preset 内的消费方发布安全工具目录。

## 入口

| 入口 | 所有权 | 工具可见性 |
|---|---|---|
| 包根入口 | 一个 Cordis 插件实例持有一个已配置服务器及其 `ctx.tools` 注册。 | 在该插件的作用域内全局可见。 |
| `./runtime` | 一个 Host 服务持有所有动态传输 generation，并实现 [`ctx.mcp`](../mcp/README.md)。 | 不直接提供；[`dsh-tool-mcp`](../tool-mcp/README.md) 在选定的 agent preset 内投影工具目录。 |

## 用法

`cordis.yml` 中每个 MCP 服务器使用一个插件实例：

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN

- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

模型会看到 `mcp__github__create_issue`、`mcp__web__search` 等工具，这与 Claude Code 和 Codex 使用的服务器限定形状相同。HMR（热模块替换）支持热替换：编辑配置项会触发断开 + 重新连接，无需重启进程；`serverName` 不变时会生成完全相同的工具名称。

## 配置

下面的字段用于配置静态包根桥接插件：

| 字段 | 传输 | 必填 | 描述 |
|---|---|---|---|
| `transport` | 两者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `serverName` | 两者 | 是 | 该服务器面向模型工具名称的 namespace；`[A-Za-z0-9_-]{1,32}`，在存活实例中唯一 |
| `command` | stdio | 是 | 要 spawn 的可执行文件 |
| `args` | stdio | 否 | 传给命令的参数 |
| `env` | stdio | 否 | 合并到已清理环境中的额外环境变量 |
| `cwd` | stdio | 否 | 子进程工作目录 |
| `url` | http | 是 | MCP 服务器 URL |
| `headers` | http | 否 | 额外标头（例如认证 token） |
| `toolCallTimeoutMs` | 两者 | 否 | 每次 `callTool` 调用的超时（默认 60000） |
| `failOnStartupError` | 两者 | 否 | 初始连接或工具同步失败时拒绝插件激活（默认 `false`） |
| `reconnect.enabled` | 两者 | 否 | 连接丢失后自动重新连接（默认 `true`） |
| `reconnect.initialDelayMs` | 两者 | 否 | 首次重连延迟（毫秒）；每次连续失败尝试翻倍（默认 500） |
| `reconnect.maxDelayMs` | 两者 | 否 | 退避上限（毫秒）；同时也是重置尝试预算所需的正常运行时长（默认 30000） |
| `reconnect.maxAttempts` | 两者 | 否 | 每次中断期间连续失败尝试次数上限，超出后彻底放弃（默认 10） |

动态 `./runtime` 入口只接受生命周期预算：`connectTimeoutMs`（默认 30000）、`reconnectInitialDelayMs`（500）、`reconnectMaxDelayMs`（30000）和 `reconnectMaxAttempts`（10）。`connectTimeoutMs` 分别限制每次 initialize 尝试、每次完整的分页 `tools/list` 发现，以及尽力而为的 HTTP session 终止。各条连接通过 `ctx.mcp.connect(...)` 传入，而不是 Cordis 配置项。

## 动态运行时的凭据与生命周期

Streamable HTTP 授权使用凭据引用，绝不使用字面量 `Authorization` header。`scheme: 'raw'` 时，运行时会为每个 HTTP 请求解析该引用并原样发送其值，不添加 `Bearer `。连接前会拒绝 `headers` 中的字面量 `Authorization`、URL 凭据、非 HTTP(S) URL 和 URL fragment。

快照、事件和诊断都不包含传输 header 或凭据值。每个非空的显式 stdio env 值、HTTP header 值以及连接期间解析到的每个凭据值都会保留在该连接的脱敏历史中，直到断开，从而在凭据轮换后仍覆盖旧的进行中响应。运行时会在工具目录和结果中递归地将这些值替换为 `[REDACTED]`；如果脱敏会改变工具名称或 task-support 枚举，该目录 generation 会以安全错误失败。Stdio 子进程获得已清理的父进程环境，再叠加连接中明确提供的 env 值。

`connect` 会预留服务器名称、初始化一个传输 generation，并读取最多 100 页且不接受重复 cursor 的 `tools/list`，再提交 `connected` 或安全的 `failed` 快照。失败的名称不会被隐式替换；调用方必须先断开再重试。`notifications/tools/list_changed` 会刷新目录；刷新失败时保留当前工具，并记录安全错误。已建立的传输关闭后会开始有界指数恢复；认证被拒绝或缺少凭据时则直接失败，不进行重试。`disconnect` 会移除工具目录、对 HTTP session 进行有界的尽力终止、关闭每个已建立或仍在初始化的客户端，并在移除服务器快照前等待连接、目录和工具调用工作结束。

## 工具命名

每个 MCP 工具都有两个名称：通过 `tools/call` 在协议上传送的原始 MCP 名称，以及公开名称 `mcp__<serverName>__<rawName>`，后者注册到 `ctx.tools`。公开名称会规范化为 DeepSeek 函数名称约定（64 个字符、`[A-Za-z0-9_-]`）；如果替换或截断改变名称，就会追加 `(serverName, rawName)` 的确定性 12 位十六进制 hash，确保不同工具绝不会折叠为同一个名称。名称是 `(serverName, rawName)` 的纯函数：连接顺序、重新同步和其他服务器永远不会重命名工具。

- 发布相同原始名称（例如 `search`）的两个服务器会在各自 namespace 下共存。
- 存活实例中的重复 `serverName` 会使后加载的插件实例失败。
- 服务器在工具列表中两次列出同一工具名称时，该列表会作为无效工具列表被拒绝。
- 外部注册抢占该服务器 namespace 时，会回滚整个世代（绝不保留部分集合），并明确报错。

## 行为

- 连接时：插件激活会等待 `listTools()`，并在组合开始首个轮次前通过 `ctx.tools.register()` 以公开名称注册每个工具。初始连接、发现或注册失败始终会记录日志；`failOnStartupError` 为 true 时拒绝激活，否则插件仍会激活但不注册工具。
- 监听 `notifications/tools/list_changed` → 重新同步；获取阶段失败时保留上一世代的注册，注册冲突则会回滚本次尝试的世代，并且不保留该服务器的任何工具。
- 工具执行：`client.callTool({ name: rawName, arguments }, { signal })`，支持超时 + 中止；公开名称绝不会发给服务器。
- 规范成功值是 `{ content: JsonValue[], structuredContent? }`；完整的 JSON MCP 块会保留给编程调用方。受支持且已声明的 `outputSchema` 会验证 `structuredContent`；不受支持的 schema 词汇会回退为不受约束的 `JsonValue`。
- Native／模型渲染保留现有文本投影：文本块以换行连接，图片、音频、资源和不受支持的块会变成占位符。
- 断开／崩溃时：supervisor 以指数退避（`reconnect.initialDelayMs` 逐次翻倍，上限 `reconnect.maxDelayMs`）重启原始服务器配置，成功后重新执行发现——恢复的世代会替换前一个，因此工具既不会重复也不会泄漏。中断期间最后一个正常世代保持注册；针对它的调用在恢复前会失败。
- 重连按中断预算控制：连续失败达到 `reconnect.maxAttempts` 次后，该服务器的工具会被注销，重连停止，直到 HMR 重载或重启 Host。连接存活超过 `maxDelayMs` 会重置预算，因此偶尔崩溃的服务器可以无限恢复，而崩溃循环的服务器——即使短暂连接成功——仍会耗尽上限而非永远重启。
- 重连状态在日志中对用户可见：reconnecting（warn，含尝试次数和延迟）、recovered（info）、最终失败和 disabled-loss（error）。dispose（资源释放）会取消任何待执行的重连。设置 `reconnect.enabled: false` 时，连接丢失后工具保持注册但调用失败，直到重载——即手动恢复行为。

## 消费的服务

| 服务 | 用途 |
|---|---|
| `ctx.tools` | 静态包根入口：注册／注销 MCP 工具。 |
| `ctx.credentials` | 动态运行时：解析凭据引用，但不发布凭据值。 |

动态运行时提供 `ctx.mcp`，不消费 `ctx.tools`。

## 模型体验

### 已发现的 MCP 工具

#### 模型看到的内容

初始发现成功后，每个已声明的 MCP 工具都会显示为名为 `mcp__<serverName>__<rawName>`（或其确定性规范化形式）的原生工具，并携带服务器提供的描述和输入 schema。成功的重新同步——包括自动重连后的同步——会替换整个世代；对插件执行 dispose（资源释放）或重连预算耗尽会移除该世代。

#### Token 影响

工具注册期间，每次请求都会承担数据相关的 schema 成本。重新同步会替换而非累积 schema，服务器限定名称也会为每个工具定义和调用增加 token。

#### KV Cache 影响

只要已发现工具集合及其 schema 不变，前缀就保持稳定。增加、移除、重命名或更改工具的重新同步会替换定义，并可能使从第一个变化的 schema token 起的复用失效；恢复了未变列表的重连会生成完全相同的定义，前缀保持稳定。

### 工具调用历史与结果

#### 模型看到的内容

公开工具名称和 JSON 参数会保留在 assistant 历史中。文本结果块会以换行连接为一个保留的 Native 文本结果；图片、音频、资源和不受支持的块在其中变为简短占位符。它们的完整 JSON 块及可选结构化内容保留在执行局部的规范值中；MCP `isError` 会通过注册表的错误路径拒绝调用。

#### Token 影响

参数和映射后的文本会保留到压缩（compaction）发生时。二进制与资源载荷会被丢弃，而不会加入上下文。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

### 动态运行时状态

#### 模型看到的内容

不直接看到任何内容。`ctx.mcp` 快照与生命周期事件保留在 Host 状态中；由限定在 preset 内的消费方决定哪些描述符和结果进入模型请求。

#### Token 影响

在消费方投影已连接目录或工具结果前没有影响。

#### KV Cache 影响

运行时状态本身没有影响。

## 已知限制与暂缓事项

- **只桥接 MCP 的工具能力**：资源和提示词没有 harness 消费接口，暂缓实现。
- **两个入口具有独立的组合约定**：包根入口仍是上文记录的静态桥接插件；`./runtime` 需要 `dsh-mcp` Service Definition 与独立消费方，动态目录才会对模型可见。
- **动态 HTTP 授权只支持凭据支撑的 raw 值**：OAuth 和其他方案需要新增 `dsh-mcp` 传输 discriminant。
- **重连在传输关闭时触发**：崩溃的 stdio 子进程会触发重连；Streamable HTTP 失败通过每次请求以及 SDK 传输自身的 SSE（Server-Sent Events）流恢复机制暴露，因此不可达的 HTTP 服务器会按调用重试，而非由 supervisor 重新 spawn。
- **Native 非文本渲染有损**：图片、音频与资源载荷在模型上下文中会变成占位符，即使执行局部的规范值保留了其 JSON 块。更丰富的 Native 多媒体投影暂缓实现。
- **不强制执行不受支持的 MCP 输出 schema**：已声明 schema 使用 harness 子集之外的词汇时，`structuredContent` 会回退到 `JsonValue`。
