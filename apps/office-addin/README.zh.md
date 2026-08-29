# DSH Office Add-in

[English](README.md) | 中文

DeepSeek Harness 的 Microsoft Excel 任务窗格。页面通过现有 DSH Session HTTP API 和 WebSocket mux 完成聊天，再通过 `dsh-office-excel-websocket` 将该 Session 与当前工作簿绑定。Office.js 始终运行在 Excel 的任务窗格环境内；Harness 进程不会直接自动化操作 Excel。

## 开发

```sh
pnpm run build
pnpm dsh web --port 3080
pnpm --filter @deepseek-ai/dsh-office-addin sideload:mac
pnpm --filter @deepseek-ai/dsh-office-addin dev
```

第一次运行 `dev` 会安装 localhost 开发证书，并请求 macOS 信任该证书。侧载后重启 Excel，然后打开 **开始 > 加载项 > DeepSeek Harness for Excel**。开发服务器监听 `https://localhost:3010`，并把 `/api` 与 WebSocket upgrade 代理到 `http://127.0.0.1:3080`；如果 Harness Web 使用其他端口，请设置 `DSH_OFFICE_HARNESS_URL`。

任务窗格支持检查工作簿、新建工作表、读取有界区域、写入矩形字面值矩阵、清空区域，以及根据已有源区域插入图表对象。每次修改都会返回 Office.js 的回读数据。

## 模型体验

任务窗格本身不贡献模型 schema。`dsh-tool-excel` Consumer 提供六个 Excel 工具；本应用只执行发往其已绑定 Harness Session 的调用。

#### Token 影响

除聊天消息和 `dsh-tool-excel` 所拥有的工具 schema 外，没有额外影响。

#### KV Cache 影响

稳定的工具 schema 进入请求前缀；聊天、工具调用和结果追加到会话尾部。

## 已知限制与暂缓事项

- 当前只提供 macOS 开发侧载助手；Windows 侧载自动化暂缓。
- 图表样式重设、数据系列编辑、删除和图片导出暂缓。
- 公式写入、格式、表格、数据透视表、工作表重命名／删除／排序和大区域分页暂缓。
