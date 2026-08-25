# MCP — 模型上下文协议

[English](README.md) | 中文

实现 MCP 能力 seam 及其静态桥接插件的包。

| 包 | 职责 |
|---|---|
| [`mcp/`](mcp/README.md) | `ctx.mcp` 动态连接注册表的 Service Definition |
| [`mcp-client/`](mcp-client/README.md) | `ctx.mcp` 的传输 Provider；包根入口同时是静态单服务器桥接插件 |
| [`tool-mcp/`](tool-mcp/README.md) | 限定在 preset 内的 Consumer，把已发现 MCP 工具投影到 `ctx.tools` |
