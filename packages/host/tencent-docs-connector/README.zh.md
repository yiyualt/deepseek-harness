# `@deepseek-ai/dsh-host-tencent-docs-connector`

[English](README.md) | 中文

这个 Web Host 服务管理一个进程级腾讯文档 MCP 连接。`tencentDocsConnector` Remote 把用户明确的连接动作转换为对固定 Streamable HTTP endpoint `https://docs.qq.com/openapi/mcp` 的连接，通过 `tencent-docs-connector/change` 投影安全状态，并把共享生命周期与传输所有权分别交给 `dsh-host-mcp-connector` 和 `ctx.mcp`。

即使已经配置[空间 MCP Token](https://docs.qq.com/open/document/mcp/get-token/)，服务启动后仍是 `disconnected`。腾讯会把该 Token 与签发时所选空间绑定。只有用户调用 `connect` 才会连接。调用成功前，服务先确认 `TENCENT_DOCS_MCP_TOKEN` 可以解析，移除已有的 `tencent_docs` MCP 条目，然后把下面的授权描述交给 `ctx.mcp`：

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { McpCredentialAuthorizationConfig } from '@deepseek-ai/dsh-mcp'

const authorization: McpCredentialAuthorizationConfig = {
  kind: 'credential',
  ref: credentialRef('TENCENT_DOCS_MCP_TOKEN'),
  scheme: 'raw',
}
```

MCP 提供方会为每个 HTTP 请求解析该引用，并把值原样作为 `Authorization` header 发送，不添加 `Bearer `。连接器不会通过 Remote 值接收或返回 Token，不缓存 Token，也不会把 Token 放入快照或诊断。Web 客户端通过仅限 loopback 的凭据 API 单独保存和删除该值。

只有 MCP 提供方完成初始化并取得 `tools/list` 后，`connect` 才会以 `connected` 结束，因此 `toolCount` 是当前可用工具目录的数量。由于 `ctx.mcp.connect` 不会替换仍然存在的名称，重试前会明确断开已有的失败或活动条目。`disconnect` 会等待传输 generation 及其所属工作完全静止后返回；插件卸载也执行同样的等待式断开。

## Remote API

| 方法 | 输入 | 结果 |
|---|---|---|
| `get` | 无 | 刷新凭据元数据后的完整当前快照。 |
| `publicGet` | 无 | 不读取凭据元数据的无凭据当前快照。 |
| `connect` | 无 | 一次明确连接尝试结束后的完整快照。 |
| `disconnect` | 无 | 等待断开完成后的完整快照。 |

仅限 loopback 的 `get`、`connect` 和 `disconnect` 方法直接返回完整快照。`get` 是读取凭据元数据的路径：除 `status`、`toolCount`、安全的 `errorCode` 与 `errorMessage` 及 `updatedAt` 外，完整值还包含 `credentialConfigured`、`credentialSource` 和 `credentialWritable`；它不包含凭据值。`connect` 与 `disconnect` 会在更改结算后返回同样的完整值。

受信任的非 loopback 客户端可以调用 `publicGet`，它返回与公开 `tencent-docs-connector/change` 事件相同的无值字段：`status`、`toolCount`、安全失败字段与 `updatedAt`。两个路径都不会读取或暴露凭据配置状态、来源、可写性或凭据值。

状态包括 `disconnected`、`connecting`、`connected`、`reconnecting`、`disconnecting` 和 `failed`。凭据事件和 MCP 事件会刷新投影。提供方会在下一个 HTTP 请求中解析轮换后的凭据；连接器既不会创建第二条传输，也不会缓存旧 header。

稳定错误码包括 `CREDENTIAL_MISSING`、`CREDENTIAL_LOOKUP_FAILED`、`AUTH_REJECTED`、`CONNECTION_FAILED`、`CONNECTION_LOST` 和 `DISCONNECT_FAILED`。所有 `errorMessage` 都是固定英文兜底文案；客户端通过 `errorCode` 本地化。HTTP 401 类 MCP 错误会映射成固定的 `AUTH_REJECTED` 文案，因此提供方诊断无法把授权值回显到浏览器。

## 模型体验

### 已连接的腾讯文档工具

#### 模型看到什么

连接后，组装的 MCP consumer 会让模型看到 `mcp__tencent_docs__<rawName>` 工具；本包自身不贡献工具 schema、prompt 文本或 session 事件。

#### Token 影响

已连接服务端返回的工具名称、描述和 JSON Schema 会占用请求 Token。具体数量由腾讯文档返回的工具目录决定；断开状态不增加 Token。

#### KV Cache 影响

连接、重连或断开可能改变下一次模型请求的工具 schema 前缀。重复的连接器快照不会进入模型上下文。

## 已知限制与暂缓工作

- 本包只连接已经签发的空间 MCP Token；不实现腾讯登录、OAuth、授权同意、Token 签发或权限选择。
- endpoint、凭据引用和 MCP 服务名固定。多腾讯文档帐号和按工作区建立连接仍暂缓。
- Host 重启后不会恢复连接意图。凭据提供方会继续保存已配置 Token，但用户必须再次点击“连接”。
- 可用的读写操作、授权要求和确认语义来自腾讯文档 MCP 服务端与组装的 MCP Tool consumer，不由这个生命周期 Remote 定义。
