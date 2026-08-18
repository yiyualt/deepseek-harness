# Agent Note：HTML 工件在 Web 右栏中预览

Status: implemented

[English](2026-08-17-web-html-artifact-preview.md) | 中文

> 范围：点击 Web 会话中的 HTML 家族文件，以及在 Web 工件栏手动输入的 HTTP(S) iframe tab。不在范围内：Office 文档、完整浏览器导航，或替代其他文件类型的原生打开行为。

## 问题

Web 表层会把每次文件点击都交回 Host 操作系统。即使当前浏览器已有可调整大小的右栏，并且能够直接渲染 HTML 工件，该文件仍会离开会话并在新浏览器标签页中打开。浏览器本身不能加载 Host 文件系统路径，而接受任意路径参数的预览路由会成为环境级文件读取器。

## 决定

现有 `openFile` callback 会先查询可选的 `chatFilePreview` 服务，再执行原生打开。ui-deliverables 插件接管 `.html`、`.htm` 和 `.xhtml`，通过 `host.prepareArtifactPreview` 准备预览，并打开共享 details 栏的 `artifact-preview` occupant。扩展名被拒绝或 provider 缺席时，流程继续执行 `workspaces.openPath`，所以组合方式和非 HTML 行为保持不变。

右栏是由 layout store 的 merge-extensible `DetailsPanelMap` 选择的 chain。ui-conversation 持有 `conversation` entry，ui-deliverables 持有 `artifact-preview`；AppFrame 提供选中的 panel id，而不导入任一功能。layout service 提供普通与宽打开模式；HTML 预览使用 520px 宽模式和 480px 中心栏下限，避免把固定宽度的生成页面压进 360px 工具详情 viewport。预览状态按 session 划分，所以切换 session 不会把文件带入另一段会话。每个 session 为每条不同 HTML 路径保留一个 tab，并在切换时保持所有就绪 iframe 挂载。`+` 操作创建空白 tab，其表单接受 HTTP(S)，省略协议时默认使用 HTTPS，并把该 tab 转换为直接 iframe；下一次受支持文件点击仍可占用尚未使用的空白 tab。关闭最后一个 tab 时关闭详情栏。

Host 把解析后的本地入口路径换成不透明 URL，并只保留其 real parent directory。GET 路由提供入口和 real path 仍位于该目录内的相对 regular-file 资源。本地入口与远程 URL 共用 `sandbox="allow-scripts allow-same-origin"`，让交互页面能够使用 origin storage，但阻止表单和 popup。本地响应 CSP 还会阻止网络连接、object、嵌套 frame 和 base 重写。远程服务器保留是否允许嵌入的决定权，因此其 CSP 或 `X-Frame-Options` 可能让 iframe 留白或显示浏览器错误。

## 考虑过的替代方案

- **在 iframe 中打开 `file://` URL**——浏览器对本地文件访问与相对资源的限制不一致，远程 Web client 也无法寻址 Host 文件系统。
- **通过 RPC 返回 HTML 文本并使用 `srcdoc`**——对单文件更简单，但相对 CSS、图片、module 和字体会失去目录基准。
- **HTML 仍使用原生打开**——保留旧实现，但无法满足会话内预览需求，也不能利用已有右栏。
- **构建带地址栏和导航控件的完整浏览器**——会增加工件栏不需要的历史、权限、popup 与下载策略；一次显式 URL 提交即可覆盖所需 embed 工作流。

## 后果

点击产出文件 chip 或匹配的 inline-code 提及会在右栏打开 HTML；另一条不同路径会新增 tab，工具调用详情仍会在被选中时重新占用右栏。空白 tab 也可以加载一个输入的 HTTP(S) URL，但受 iframe sandbox 和远程网站嵌入策略约束。本地预览支持相对资源、inline script、交互和同源存储，但刻意禁止网络请求与表单提交。单元覆盖固定 Host grant、保留的 tab、URL 校验与 iframe 生命周期，`apps/web/tests/produced-file-mentions.e2e.ts` 则创建真实交互式 HTML 文件、点击组装后的提及，并通过正式 Web 组合操作 iframe 内的按钮。
