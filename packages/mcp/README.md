# MCP — Model Context Protocol

English | [中文](README.zh.md)

Packages implementing the MCP capability seam and its static bridge.

| Package | Role |
|---|---|
| [`mcp/`](mcp/README.md) | Service Definition for the dynamic connection registry at `ctx.mcp` |
| [`mcp-client/`](mcp-client/README.md) | Transport Provider for `ctx.mcp`; its package-root entry is also the static single-server bridge |
| [`tool-mcp/`](tool-mcp/README.md) | Preset-scoped Consumer that projects discovered MCP tools onto `ctx.tools` |
