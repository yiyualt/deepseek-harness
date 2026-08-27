# Agent Note：通过腾讯文档 WebSDK 预览本地文档

Status: implemented

[English](2026-08-27-web-tencent-docs-preview.md) | 中文

## 问题

Web 工件栏能够渲染 HTML、编辑 Markdown，并把 DOCX 编辑委托给可选的 Document Server，但没有适用于电子表格、演示文稿、PDF、旧版 Office 格式或只读文档工作流的浏览器渲染器。原生打开还会把文件交给 Host 桌面，无法让结果留在对话旁边。

## 决定

Web 组合可以把腾讯文档 WebSDK 配置为可选的只读工件 provider。预览控制器接管 DOC、DOCX、TXT、XLS、XLSX、CSV、PPT、PPTX 和 PDF 路径。Host 准备带判别字段的 `tencent-docs` 值，其中包含 SDK URL 与浏览器安全的初始化字段。client 按 URL 只加载一次脚本，在保留的工件 tab 内初始化 SDK、等待就绪，并在 tab 卸载时销毁 SDK 实例。

本地文件仍是权威来源。准备操作解析真实 regular-file 路径，创建不透明的进程内文件与下载 capability，通过 credential service 解析应用密钥，并计算腾讯应用签名。密钥不会进入 RPC 或浏览器状态。腾讯发起的带签名 callback 请求会得到只读权限、文件元数据、capability 下载 URL 以及禁用的水印响应。下载 route 支持完整读取和一段 HTTP byte range，使远端渲染器能够在较大格式中定位。复制、评论与打印权限均关闭。

部署需要提供应用 ID、credential reference 以及公开的 HTTPS Harness origin。腾讯必须能够访问 `<public-origin>/api/tencent-docs`，Web 信任围栏也必须允许该 authority。每次显式重新打开都会准备新 grant，使保留 tab 能够在 Host 重启后恢复。未配置 provider 时，Host 会拒绝这些文档扩展名；client 删除临时文件 tab，并让普通原生 opener 继续处理。发生这种交接时，尚未使用的空白工件 tab 会恢复。现有的可编辑 DOCX provider 在未配置腾讯文档时仍作为独立回退。

收尾消息中的 mention 会接受没有 mutation location 的精确受支持文档路径，因为 terminal process 通常负责创建二进制工件。产出文件行仍只依据权威 mutation location。

## 考虑过的替代方案

- **把每个文件上传到腾讯文档 workspace**——会改变资产所有权与生命周期，而 WebSDK 已经能够渲染 callback 提供的字节。
- **暴露直接本地路径或稳定公开文件 URL**——会泄漏 Host 文件系统标识，或授予超过单次预览所需的访问范围。
- **完全在浏览器内初始化 SDK**——无法保护应用密钥，也无法响应腾讯的服务端 callback。
- **在 Harness client 中自行实现格式渲染器**——会让 Office 与 PDF 兼容性成为 Harness 的责任，并重复已有的维护中引擎。

## 后果

配置完成的 Web 部署会在对话旁预览受支持的文档家族，而文件仍留在本地工作区。腾讯服务在渲染过程中必然接收这些字节，因此这不是离线预览。该集成只读：不保存编辑、不创建腾讯文档资产、不提供协作，也不调用腾讯文档 MCP 工具。grant 会在重启时消失，并在下一次显式点击时替换。Host 测试固定签名、callback 认证、元数据、capability 下载、HTTP Range 与错误分类；client 测试固定接管、可选 provider 交接、保留 tab 刷新与 SDK 生命周期。现有 ONLYOFFICE Agent Note 继续有效，因为它负责另一项可编辑 DOCX 与写回决定。
