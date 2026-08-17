# Agent Note：通过 ONLYOFFICE 编辑 DOCX 工件

Status: implemented

[English](2026-08-18-web-docx-onlyoffice-editing.md) | 中文

## 问题

Web 工件栏可以承载浏览器能渲染的 HTML，但 Chromium 无法把 DOCX OOXML 解释成可编辑文档。把 DOCX 直接当作 iframe URL 会触发下载，无法得到兼容 Word 的排版与编辑；转换成 PDF 又会丢失所需的编辑路径。

## 决定

ui-deliverables 预览控制器也接管 `.docx`，并在 HTML iframe 渲染器旁保留 Office 渲染器。Host 返回带判别字段的预览值：HTML 携带同源 URL，DOCX 携带外部 ONLYOFFICE Docs API URL 以及 `word`／`docx` 编辑器配置。该配置包含空的 `editorConfig.customization` 对象，因为 ONLYOFFICE 9.4 会在应用可选设置前读取这个对象。client 只加载该 API 一次，在右栏当前标签页内挂载 `DocsAPI.DocEditor`，切换标签页时保持编辑器挂载，并在关闭标签页时销毁编辑器。

即使轮次没有记录 produced mutation location，收尾正文 mention resolver 也会接受精确的 `.docx` 行内代码 token。二进制 DOCX 输出通常由 terminal process 而非文本修改工具创建，否则无法成为可点击工件。普通 chat 文件 opener 会按 session cwd 解析 token，用户点击时 Host 仍会拒绝缺失或并非文件的目标。产出文件行继续只采用权威 mutation location。

选择已有 DOCX 路径时会准备新 grant 并替换编辑器配置，而不只是激活保留的编辑器。grant 只存在于当前进程并在 Host 重启时失效；重新准备使下一次显式文件点击可以恢复该 tab，而无需先丢弃它。HTML 在重复选择时继续保留 iframe，因为保留交互页面状态是其 tab 行为的核心。

Host 持有本地路径并签发一个不透明的内存 grant。ONLYOFFICE 从该 grant 的文件 route 下载当前字节。状态为 `2` 或 `6` 的保存 callback 携带 Document Server 下载 URL；Host 把这些字节提取到同目录临时文件，通过 rename 覆盖获授权的工作区路径，然后才确认成功。其他 callback 状态只确认，不修改文件。

部署需要配置两个地址，因为浏览器与 Document Server 可能拥有不同网络视图：`browserUrl` 供浏览器访问 ONLYOFFICE，`harnessUrl` 供 ONLYOFFICE 访问 Harness。Web bundle 从 `DSH_ONLYOFFICE_URL` 和 `DSH_ONLYOFFICE_HARNESS_URL` 读取它们。缺少任一地址时，DOCX 准备会报告不可用。首个集成刻意只支持现代 `.docx`，并假定可信的本地部署关闭 ONLYOFFICE JWT；旧 DOC、电子表格、演示文稿、协作身份和版本历史均不属于本决定。

## 考虑过的替代方案

- **把 DOCX 转换为 PDF**——能提供稳定的浏览器预览，但无法保留可编辑 Office 工作流。
- **把 OOXML 转换为普通 HTML**——能够支持部分查看，但要往返保留 Word 排版、表格、分页、图片和样式，仍然需要文档编辑器而非转换器。
- **在 Harness client 中实现 Word 编辑器**——会重复成熟文档引擎，并让 OOXML 兼容性成为 Harness UI 的责任。
- **首次集成就支持全部 Office 格式**——会在文档服务器生命周期尚未确立时增加保存和转换分支；DOCX 可以提供一条完整纵向路径。

## 后果

完成配置的 Web 部署会在不转换 PDF 的情况下，以兼容 Word 的可编辑 UI 打开 DOCX 工件，并把完成的保存写回原工作区路径。浏览器到 ONLYOFFICE、ONLYOFFICE 到 Harness 都必须可达；Docker 通常需要为两者使用不同 origin。grant 只存在于当前进程，编辑会替换源文件；这条本地优先路径不提供 JWT 认证、修订历史、冲突解决或 Host 重启后的恢复。Host 测试固定配置、文件提供、callback 状态处理与写回，client 测试固定 DOCX 接管与 `DocEditor` 生命周期。
