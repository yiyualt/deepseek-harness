# Agent Note: 在 Web 工件栏编辑本地 Markdown

Status: implemented

[English](2026-08-18-web-markdown-artifact-editing.md) | 中文

## 问题

Web 工件栏可以显示 HTML，也能把 DOCX 交给 ONLYOFFICE，但点击本地 Markdown 文件仍会离开应用。产品内已经有用于 assistant 消息的 Markdown 渲染器，但浏览器无法自行读取或保存任意 Host 路径。把 Markdown 当作 iframe 页面，只会显示源码文本，既没有编辑器，也没有可靠的写回路径。

## 决策

ui-deliverables 预览控制器在 HTML 和 DOCX 之外接管 `.md` 与 `.markdown`。即使没有 produced mutation location，精确的 Markdown 行内代码路径也保持可点击，从而覆盖 terminal 创建的文本工件。Host 从规范化后的普通文件路径读取最多 2 MiB 的 UTF-8 源码，返回源码、对应的 SHA-256 修订值及一份不透明的进程内编辑 grant；它不会把文件系统路径暴露为浏览器 URL。

右栏 tab 显示源码编辑器与实时预览的左右分栏。预览复用 `MarkdownText`，因此本地工件与 assistant Markdown 共用既有的 CommonMark、GFM、代码、数学公式、URL、原始 HTML 和远程图片行为。编辑只改变会话内草稿状态；保存会把完整源码、grant 和最后观察到的修订值发送给 Host。

Host 保存前会再次读取文件。若修订值已改变，则返回 `artifact-preview-conflict`，磁盘内容与浏览器草稿都保持不变。若修订值匹配，Host 会先写入同目录临时文件，再通过 rename 覆盖获授权的路径，并把新修订值作为下一次保存的前置条件返回。grant 会在 Host 重启后失效；重新打开文件即可取得新的源码快照和 grant。

## 考虑过的替代方案

- **在 iframe 中渲染 Markdown**——浏览器可以显示所提供的纯文本，但 iframe 不会带来 Markdown 解析器、源码编辑器或受控写回操作。
- **让浏览器按路径直接保存**——会把任意 Host 路径放进普通请求，也会让陈旧的浏览器状态覆盖 Agent 或外部程序的修改。
- **复用 ONLYOFFICE**——会为客户端已经能够解析的文本格式增加文档服务器，而且提供的是文字处理界面，而非 Markdown 源码语义。
- **不检查修订值直接覆盖**——实现更简单，但人和 Agent 同时编辑时会退化为最后写入者获胜，并静默丢失数据。

## 后果

点击产出的 `.md` 或 `.markdown` 工件，会打开一个保留的 tab，其中包含可编辑源码与即时渲染结果；保存会写回原始本地文件，不需要转换 PDF，也不需要外部文档引擎。2 MiB 上限约束 RPC 和 DOM 开销。保存采用整文件、单用户模型：它能发现并发修改，但不会合并内容、保留历史、自动保存或协调光标。单元测试固定 grant 读取、修订冲突、客户端状态和渲染；组装层 Web 场景会编辑一份真实 Markdown 工件，并验证写入磁盘的字节。
