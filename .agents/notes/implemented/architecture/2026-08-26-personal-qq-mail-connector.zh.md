# Agent Note：个人 QQ 邮箱使用有界 IMAP 与 SMTP 工具

Status: implemented

[English](2026-08-26-personal-qq-mail-connector.md) | 中文

## 问题

公开的 Agently Mail CLI 授权的是隔离的 Agent Mail workspace，而不是用户已有的个人 QQ 邮箱。WorkBuddy 的个人邮箱连接器看起来依赖未公开为公共 MCP endpoint 或可复用 OAuth client 的提供方私有集成。交付的连接器不能把另一个 Agent Mail 账号标成用户的 QQ 邮箱。

## 决策

[`@deepseek-ai/dsh-host-qq-mail-connector`](../../../../packages/host/qq-mail-connector/README.md) 通过 QQ 邮箱标准 IMAP 和 SMTP endpoint 连接个人 `@qq.com` 邮箱。loopback 用户通过不透明凭据引用提供邮箱地址和 IMAP/SMTP 授权码。授权码不是 QQ 密码。Host 通过 IMAP 验证授权码，只发布不含凭据的生命周期状态。

`standard`、`code` 和 `cordis` preset 挂载一个 scoped Consumer，仅在账号已连接时注册 `qq_mail_list`、`qq_mail_search`、`qq_mail_read` 和 `qq_mail_send`。每个工具都会在网络操作前立即请求 Harness 单次审批。邮件内容是不可信数据，绝不会获得指挥 agent 的权限。

连接器会为每次 IMAP 或 SMTP 操作重新解析凭据，绝不会在快照、公开事件、模型请求、结果或日志中缓存凭据。协议日志保持关闭。操作和返回正文都有上限，读取结果不包含附件字节，认证与网络错误会被统一处理。

## 考虑过的替代方案

**保留 Agently Mail CLI 连接器。** 拒绝，因为它暴露的是 CLI 的隔离 Agent Mail 账号，不是用户的个人 QQ 邮箱。

**复刻 WorkBuddy 的浏览器登录。** 拒绝，因为没有公开的提供方 OAuth client、redirect 约定或 API。只复制界面外观并不能建立有效的个人邮箱授权链路。

**把 QQ 邮箱配置为托管 MCP。** 拒绝，因为 QQ 邮箱没有为该账号流程提供兼容的公共 MCP endpoint。IMAP 和 SMTP 才是已发布的邮件客户端协议。

**暴露原始 IMAP 或 SMTP 命令。** 拒绝，因为协议命令会形成不安全且不稳定的模型表层。四个领域工具让校验和用户审批保持明确。

## 验证

包测试覆盖缺失与轮换凭据、账号验证、列出/搜索/读取/发送行为、响应上限、安全失败、目录注册、校验和审批结果。浏览器与 Host fence 测试覆盖凭据草稿、事件转发、仅允许 loopback 的变更和安全公开读取。装配后的 preset 目录证明四个 QQ 邮箱工具只在挂载 Consumer 且账号已连接时出现。

## 后果

- 用户开启 IMAP/SMTP 并生成授权码后，连接器访问其个人 QQ 邮箱。
- QQ 邮箱保持独立于通用 MCP runtime 及其远程工具发现。
- 第一版支持收件箱列出、搜索、读取和纯文本发送；文件夹、附件传输、删除、回复、转发和富文本编写暂不支持。
- 未来官方 MCP endpoint 或合作 OAuth 集成可以替换提供方实现，而不改变四个面向用户的工具用途。
