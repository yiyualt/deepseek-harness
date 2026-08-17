# Agent Note：HTML 工件在 Web 右栏中预览

Status: implemented

[English](2026-08-17-web-html-artifact-preview.md) | 中文

> 范围：点击 Web 会话中产出或提及的 HTML 家族文件。不在范围内：Office 文档、任意网页浏览、远程 URL，或替代其他文件类型的原生打开行为。

## 问题

Web 表层会把每次文件点击都交回 Host 操作系统。即使当前浏览器已有可调整大小的右栏，并且能够直接渲染 HTML 工件，该文件仍会离开会话并在新浏览器标签页中打开。浏览器本身不能加载 Host 文件系统路径，而接受任意路径参数的预览路由会成为环境级文件读取器。

## 决定

现有 `openFile` callback 会先查询可选的 `chatFilePreview` 服务，再执行原生打开。ui-deliverables 插件接管 `.html`、`.htm` 和 `.xhtml`，通过 `host.prepareArtifactPreview` 准备预览，并打开共享 details 栏的 `artifact-preview` occupant。扩展名被拒绝或 provider 缺席时，流程继续执行 `workspaces.openPath`，所以组合方式和非 HTML 行为保持不变。

右栏是由 layout store 的 merge-extensible `DetailsPanelMap` 选择的 chain。ui-conversation 持有 `conversation` entry，ui-deliverables 持有 `artifact-preview`；AppFrame 提供选中的 panel id，而不导入任一功能。layout service 提供普通与宽打开模式；HTML 预览使用 520px 宽模式和 480px 中心栏下限，避免把固定宽度的生成页面压进 360px 工具详情 viewport。预览状态按 session 划分，所以切换 session 不会把文件带入另一段会话。每个 session 为每条不同 HTML 路径保留一个 tab，在切换时保持所有就绪 iframe 挂载，提供 `+` 操作并让当前空白 tab 接收下一条 HTML 路径，在最后一个 tab 关闭时关闭详情栏。

Host 把解析后的入口路径换成不透明 URL，并只保留其 real parent directory。GET 路由提供入口和 real path 仍位于该目录内的相对 regular-file 资源。iframe 使用 `sandbox="allow-scripts allow-same-origin"`，让交互页面能够使用同源存储；响应 CSP 阻止网络连接、表单、object、嵌套 frame 和 base 重写。这些限制让生成的 HTML 可以展示自包含视觉输出，同时不把预览变成通用浏览器标签页。

## 考虑过的替代方案

- **在 iframe 中打开 `file://` URL**——浏览器对本地文件访问与相对资源的限制不一致，远程 Web client 也无法寻址 Host 文件系统。
- **通过 RPC 返回 HTML 文本并使用 `srcdoc`**——对单文件更简单，但相对 CSS、图片、module 和字体会失去目录基准。
- **HTML 仍使用原生打开**——保留旧实现，但无法满足会话内预览需求，也不能利用已有右栏。
- **构建带转换器和导航控件的通用工件浏览器**——当前观察到的需求只有 HTML，不需要这套系统；其他格式继续使用原生打开。

## 后果

点击产出文件 chip 或匹配的 inline-code 提及会在右栏打开 HTML；另一条不同路径会新增 tab，工具调用详情仍会在被选中时重新占用右栏。预览支持本地相对资源、inline script、交互和同源存储，但刻意禁止网络请求与表单提交。单元覆盖固定 Host grant、保留的 tab 与 iframe 生命周期，`apps/web/tests/produced-file-mentions.e2e.ts` 则创建真实交互式 HTML 文件、点击组装后的提及，并通过正式 Web 组合操作 iframe 内的按钮。
