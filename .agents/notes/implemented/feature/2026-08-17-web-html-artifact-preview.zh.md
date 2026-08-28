# Agent Note：HTML 工件在 Web 右栏中预览

Status: implemented

[English](2026-08-17-web-html-artifact-preview.md) | 中文

> 范围：在 Web 工件栏编辑 HTML 家族文件，以及手动输入 HTTP(S) iframe tab。不在范围内：Office 文档、完整浏览器导航，或替代其他文件类型的原生打开行为。

## 问题

Web 表层会把每次文件点击都交回 Host 操作系统。即使当前浏览器已有可调整大小的右栏，并且能够直接渲染 HTML 工件，该文件仍会离开会话并在新浏览器标签页中打开。浏览器本身不能加载 Host 文件系统路径，而接受任意路径参数的预览路由会成为环境级文件读取器。

## 决定

现有 `openFile` callback 会先查询可选的 `chatFilePreview` 服务，再执行原生打开。ui-deliverables 插件接管 `.html`、`.htm` 和 `.xhtml`，通过 `host.prepareArtifactPreview` 准备预览，并打开共享 details 栏的 `artifact-preview` occupant。扩展名被拒绝或 provider 缺席时，流程继续执行 `workspaces.openPath`，所以组合方式和非 HTML 行为保持不变。

右栏是由 layout store 的 merge-extensible `DetailsPanelMap` 选择的 chain。ui-conversation 持有 `conversation` entry，ui-deliverables 持有 `artifact-preview`；AppFrame 提供选中的 panel id，而不导入任一功能。layout service 提供普通与宽打开模式；HTML 编辑使用 520px 宽模式和 480px 中心栏下限，避免把固定宽度的生成页面压进 360px 工具详情 viewport。预览状态按 session 划分，所以切换 session 不会把文件带入另一段会话。每个 session 为每条不同 HTML 路径保留一个 tab。`+` 操作创建空白 tab，其表单接受 HTTP(S)，省略协议时默认使用 HTTPS，并把该 tab 转换为直接 iframe；下一次受支持文件点击仍可占用尚未使用的空白 tab。关闭最后一个 tab 时关闭详情栏。

Host 把解析后的本地入口路径换成彼此独立的不透明资源 grant 与编辑 grant。准备结果包含有大小上限的 UTF-8 源码及其 SHA-256 revision；GET 路由提供入口和 real path 仍位于获授权目录内的相对 regular-file 资源。可视化编辑器通过 `srcdoc` 渲染源码，注入指向这些获授权资源的同源 base URL，禁用脚本，并启用浏览器原生文档编辑。编辑结果序列化回 HTML 时会移除注入的 base 与 CSP 元数据。源码模式直接编辑完整文本，用于需要精确控制标签、样式或脚本的修改。

`host.saveHtmlArtifact` 只通过编辑 grant 接受完整源码。Host 先用提交的 revision 校验当前文件 hash，再通过同目录临时文件原子替换原文件；外部修改会返回 `artifact-preview-conflict`，且不会被覆盖。手动输入的远程 URL 仍是允许脚本与同源行为的 sandbox iframe tab；远程服务器保留是否允许嵌入的决定权，因此其 CSP 或 `X-Frame-Options` 可能让 iframe 留白或显示浏览器错误。

## 考虑过的替代方案

- **在 iframe 中打开 `file://` URL**——浏览器对本地文件访问与相对资源的限制不一致，远程 Web client 也无法寻址 Host 文件系统。
- **把本地页面保留为允许脚本的 iframe**——能够保留所有运行时交互，但同源脚本执行与父页面驱动的可视化编辑不兼容；源码模式会保留文件中的脚本，而可视化编辑不会执行它们。
- **只编辑 HTML 原始源码**——能保留精确文本，却让普通文案修改变得不必要地困难；直接可视化编辑旁仍提供源码模式。
- **HTML 仍使用原生打开**——保留旧实现，但无法满足会话内预览需求，也不能利用已有右栏。
- **构建带地址栏和导航控件的完整浏览器**——会增加工件栏不需要的历史、权限、popup 与下载策略；一次显式 URL 提交即可覆盖所需 embed 工作流。

## 后果

点击产出文件 chip 或匹配的 inline-code 提及会在右栏打开可编辑 HTML 页面；另一条不同路径会新增 tab，工具调用详情仍会在被选中时重新占用右栏。可视化模式支持浏览器原生的文字与结构直接编辑，同时保留相对本地样式、图片和字体；源码模式暴露完整 HTML。只有 revision 一致时，保存才会重写原文件。可视化模式不执行页面脚本，因此脚本驱动的输出需要在源码模式中修改，并在编辑器外重新打开后观察。空白 tab 也可以加载一个输入的 HTTP(S) URL，但受 iframe sandbox 和远程网站嵌入策略约束。单元覆盖准备、原子保存、冲突、保留 tab、URL 校验与两种编辑模式；组装后的 Web 场景会在可视化模式中修改真实 HTML 标题、保存并校验工作区字节。
