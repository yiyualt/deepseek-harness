# @deepseek-ai/dsh-tool-mcp

[English](README.md) | 中文

`dsh-tool-mcp` 是 `ctx.mcp` 的 Consumer。它挂载在 Agent preset 作用域内，让该作用域的 `ctx.tools` 注册与动态 MCP 目录保持同步，同时不向工具定义暴露传输客户端。

## 用法

把 Consumer 挂载到需要获得已连接工具的 preset 内：

```yaml
- id: tool-mcp
  name: '@deepseek-ai/dsh-tool-mcp'
  config:
    toolCallTimeoutMs: 60000
```

它在激活时读取当前快照，并监听 `mcp/change`。每个工具注册为 `mcp__<serverName>__<rawName>`。需要替换字符或截断的名称会获得确定性哈希后缀，因此两个 MCP 身份不会折叠为同一个公开名称。

目录更新会先完成准备和校验，再移除上一代。无法支持的输入 schema 会保留上一代。注册冲突会回滚新一代已尝试的所有注册，因此作用域不会得到残缺 MCP 目录。服务器处于 `reconnecting` 时，运行时可以保留 last-good 目录；这些 schema 仍然可见，但调用会失败，直到连接恢复。preset 被销毁时会移除全部注册。

## 执行与策略

工具定义只保留不透明服务器名和原始工具名。每次执行 MCP 调用时，执行器都会紧邻 `ctx.mcp.callTool(...)` 之前请求一次经过审计的批准；工具流水线中更早的决策无法绕过这项 last-mile 检查。只有 `allowed-once` 会继续执行。缺少 approval 服务、调用缺少 agent，或结果为 `rejected`、`cancelled`、`unavailable` 时，都会在传输派发前失败。

批准请求会标明公开工具名称和 call id，携带调用者的中止信号，并使用 `MCP tool may change external data` 作为理由。MCP annotations 是远端服务器提供的不受信任声明，因此即使 `readOnlyHint: true` 也不能授予执行权限。

要求 task 的 MCP 工具仍然可见，但会在传输调用前失败，因为这个 Consumer 没有实现基于 task 的执行。

## 结果投影

规范值保留全部 MCP JSON 内容块和可选结构化内容。Native 渲染会拼接文本块，并用紧凑占位符替换图像、音频、资源和未知块，因此二进制或资源载荷不会进入模型上下文。服务器返回的 `isError` 会进入普通工具失败路径。

## 使用的服务

| 服务 | 用途 |
|---|---|
| `ctx.mcp` | 观察安全目录并调用当前服务器代际 |
| `ctx.tools` | 注册作用域工具并保护其执行 |
| `ctx.approval` | 在传输派发前立即批准一次可执行调用；缺失时关闭式失败 |

## 模型体验

### 已连接的 MCP 工具

#### 模型看到什么

每个 last-good 描述符都会成为名为 `mcp__<serverName>__<rawName>`（或其确定性规范化形式）的作用域工具，并包含服务器描述和输入 schema。目录移除或 preset 销毁会移除它。每个 MCP 调用在派发前都需要用户批准；重连期间保留的目录可能仍然可见，但调用会暂时失败。

#### Token 影响

在目录或作用域变化前，每个可见描述符都会把名称、描述和 schema 加入每次请求。工具参数和渲染结果会保留在会话历史中，直到 compaction。

#### KV Cache 影响

作用域目录不变时前缀稳定。添加、移除或修改描述符可能从首个变化的工具 schema token 起使复用失效；后续工具调用和结果追加在可复用前缀之后。

## 已知限制与后续工作

- 只投影 MCP 工具；MCP 资源和提示词在这里不面向模型。
- 尚未实现 MCP task-required 执行。
- Native 渲染仅支持文本，并在执行本地规范值保留非文本载荷后，有意从模型投影中丢弃这些载荷。
- 安全标注是远端服务器提供的不受信任声明，只作为信息保留。每次可执行 MCP 调用都会经过执行器持有的 last-mile 批准；未来若要免确认，必须使用独立的 Host-owned 已审核策略。
