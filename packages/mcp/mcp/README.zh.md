# @deepseek-ai/dsh-mcp

[English](README.md) | 中文

`dsh-mcp` 是动态 Model Context Protocol 连接的 Service Definition。它提供 `ctx.mcp`；传输 Provider 实现连接代际、凭据解析、重连、目录发现和清理，Consumer 只读取安全快照并通过运行时调用原始工具名。

## API

| 方法 | 用途 |
|---|---|
| `connect({ serverName, transport, activationCheck? })` | 启动一个命名连接，并在首次状态提交后结束 |
| `disconnect(serverName)` | 撤下目录、停止自有工作、等待传输静默，然后从快照中移除 |
| `snapshot()` | 返回完整的安全注册表版本和服务器目录 |
| `callTool({ serverName, name, args, signal, timeoutMs })` | 在当前传输代际上调用原始工具名 |

使用 `mcpServerName(value)` 创建名称。名称接受 1 到 32 个 ASCII 字母、数字、`_` 或 `-`，并且在此包外保持不透明。

只要名称仍在 `snapshot().servers` 中，`connect` 就会拒绝它，包括已连接、失败或正在断开的条目。替换配置或重试失败连接必须显式执行 `await disconnect(name)`，再调用 `connect(...)`。断开未知名称是无操作。

可选的 Host-owned `activationCheck` 指定一个发现到的只读工具、固定 JSON 参数、超时和同进程结果 classifier。Provider 会在发布 `connected` 前执行它，并在每次重连 generation 重复执行。只有 `accepted` 会激活目录；拒绝会关闭初始化中的传输并发布安全失败。

## 传输与凭据

传输联合类型目前支持子进程 stdio 和 Streamable HTTP。HTTP 授权与普通请求头分开配置：

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { McpStreamableHttpTransportConfig } from '@deepseek-ai/dsh-mcp'

const transport: McpStreamableHttpTransportConfig = {
  kind: 'streamable-http',
  url: 'https://example.test/mcp',
  authorization: {
    kind: 'credential',
    ref: credentialRef('EXAMPLE_MCP_TOKEN'),
    scheme: 'raw',
  },
}
```

`scheme: 'raw'` 会把解析出的凭据原样作为 `Authorization` 值发送；`scheme: 'bearer'` 会添加标准 `Bearer ` 前缀。随产品交付的运行时会为每个 HTTP 请求解析该引用，因此替换后的凭据会在下一个请求中生效，无需重连活跃传输；替换凭据本身不会触发重连。Provider 会拒绝 `headers` 中的 `Authorization` 键；快照和诊断绝不包含传输请求头或解析后的凭据值。

## 快照与事件

每个服务器快照都有状态（`connecting`、`connected`、`reconnecting`、`failed` 或 `disconnecting`）、传输代际、最近一次成功发布的工具描述符，以及可选的安全 `errorCode` 和 `errorMessage`。短暂的 `reconnecting` 状态可以保留这个 last-good 目录以维持 schema 稳定，但在服务器恢复为 `connected` 前，`callTool` 会拒绝调用。认证失败、重连耗尽和 `disconnecting` 会清空目录。断开完成后会移除服务器，而不是保留 `disconnected` 墓碑。

Provider 先提交状态，再调用受保护的 `notifyChange()`。它通过不受作用域过滤的 `mcp/change` 发送完整当前快照；普通监听器失败会被隔离并记录，同步 invariant 失败则会在所有监听器运行后继续抛出。

工具描述符保留输入和输出 schema、任务支持，以及四个标准 MCP 安全提示：`readOnlyHint`、`destructiveHint`、`idempotentHint` 和 `openWorldHint`。这些提示是远端服务器提供的不受信任信息，只用于展示和审计，不会授予执行权限。

## 模型体验

### MCP 连接状态

#### 模型看到什么

这个 Service Definition 本身不会直接向模型展示内容。`@deepseek-ai/dsh-tool-mcp` 等 Consumer 决定哪些目录条目成为模型工具，以及如何渲染结果。

#### Token 影响

在 Consumer 把描述符或结果投影到模型请求前没有影响。

#### KV Cache 影响

运行时快照或生命周期事件本身没有影响。

## 已知限制与后续工作

- 此包定义运行时接口，但不提供传输实现。
- 目录目前只覆盖 MCP 工具；资源和提示词需要独立 Consumer 后才能进入此 seam。
- 授权支持凭据支撑的 HTTP 原样值和 Bearer 值。OAuth 需要独立的授权生命周期，不能改变这两种 scheme 的语义。
