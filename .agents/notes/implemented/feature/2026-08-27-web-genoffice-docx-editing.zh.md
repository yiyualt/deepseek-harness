# Agent Note：通过 GenOffice 本地编辑 DOCX 富文本

Status: implemented

[English](2026-08-27-web-genoffice-docx-editing.md) | 中文

## 问题

Agent 生成的 DOCX 可以交给外部预览或文档服务，但正式 Web 应用无法在不配置服务凭据和上传生命周期的情况下，直接在对话旁编辑工作区文档。目标交互是本地的：点击生成文件，在右侧工件栏中编辑，再保存回同一路径。

## 决定

正式 Web 组合启用本地 `genoffice-docx` 工件 provider。GenOffice 的 DOCX 与 PPTX 引擎源码固定在 commit `583a045212f871943afb8ca4503fcb5ddf99a23f`，纳入仓库构建并打包进 Host gateway。因此，准备 DOCX 不需要应用 ID、凭据、公开 callback URL 或文档服务器。

Host 持有路径与 OOXML。准备操作解析真实常规文件，执行可配置的 `genOfficeDocxMaxBytes` 限制，用 SHA-256 源文件修订值创建不透明进程内 grant，并返回浏览器安全的 block 投影。不包含原子字段或结构修订的普通段落、标题和列表项 run 可以编辑；表格、图片、公式、字段、文本框、修订及其他复杂内容作为受保护投影返回。

浏览器把可编辑 block 显示为一张连续的 TipTap 文档页，并提供字体、字号、粗体、斜体、下划线、删除线、字体颜色、突出显示和段落对齐功能区。工件栏以 520px 打开，可以拖动到 960px，同时布局为会话栏保留至少 480px。transaction guard 保持原始顶层 block index 顺序，因此字符与受支持的段落格式操作不能合并、拆分、新增或删除 OOXML body block。保存操作通过 `host.saveGenOfficeDocxArtifact` 发送 block index 与完整格式 run。Host 对照 grant 解析结果校验每个 index，拒绝未知或受保护的 block，验证 grant revision 与当前文件 hash，再让 GenOffice 只重新生成发生修改的段落，并通过同目录临时文件原子替换原文件。未修改和受保护的 OOXML body element 仍使用 original save block。磁盘文件变化会返回 `artifact-preview-conflict`，且不会覆盖任一方内容。

启用后，本地 GenOffice DOCX 准备优先于已配置的外部 Office provider。部署可以关闭它，并保留现有腾讯文档或旧有 DOCX provider 行为。已有腾讯文档和 ONLYOFFICE Note 对这些部署选择仍有独立价值，本决策不归档它们。

## 考虑过的替代方案

- **嵌入 GenOffice Electron 应用**——其 renderer 依赖 Electron preload API，并不是可嵌入的 Web SDK。
- **把文件上传到托管编辑器**——会为本地编辑请求增加凭据、网络访问和远程资产生命周期。
- **把文档压平成纯文本**——会丢弃 OOXML 内容与格式，而不是保留受保护 block。
- **在首次改动中启用全部 GenOffice 控件**——会复制大规模桌面 UI，并在共享 grant 与写回路径得到验证前混合 DOCX、PPTX、XLSX 三种 Host 架构。

## 后果

生成的 DOCX 可以在正式 Web 应用内部打开，以连续富文本方式编辑，并保存回工作区中的同一路径。Host 单元测试运行带格式的 GenOffice 解析／保存往返并覆盖外部修改冲突；client 测试覆盖功能区、文档编辑面、草稿与保存状态；无密钥的组装 Web 场景会编辑真实 DOCX，并从磁盘重新解析保存后的字节。

这不是完整的 Word 兼容编辑器。界面禁止编辑复杂 block，也不支持新增或删除段落、样式、页眉、批注或页面布局控件。PPTX 与 XLSX 仍沿用已有预览路径；其原生 GenOffice 编辑器需要各自的浏览器安全渲染和保存 adapter。
