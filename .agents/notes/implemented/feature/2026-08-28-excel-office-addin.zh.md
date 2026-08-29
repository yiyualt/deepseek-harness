# Agent Note: Excel Office Add-in

Status: implemented

[English](2026-08-28-excel-office-addin.md) | 中文

## 问题

DeepSeek Harness 已有浏览器聊天和独立工作簿产物生成，但 Agent 无法操作桌面 Microsoft Excel 中当前打开的工作簿。只在 Host 中接入 Excel SDK 无法可靠识别用户正在使用的工作簿，还会把文档权威移出 Excel。该集成需要由 Excel 持有的执行边界、精确 Session 路由、明确的断开行为，以及能够独立侧载的任务窗格。

## 决策

功能拆成四个插件。`dsh-office-excel` 定义单 Provider 能力接缝；`dsh-office-excel-websocket` 提供回环、精确 Origin 的 WebSocket 路由，把一个存活 Harness Session 绑定到一个工作簿连接；`dsh-tool-excel` 提供六个模型侧工具，并按照调用 Agent 的 Session id 路由；`dsh-office-addin` 是独立 React/Vite 任务窗格，聊天复用现有 HTTP unary API 和 WebSocket mux，反向 WebSocket 只承载带关联 id 的 Office.js 调用与 JSON 结果。

任务窗格把实时 mux 事件和持久化 Session 历史归并到同一套时间线模型。它只渲染 `source.kind` 为 `user` 的 `user/message`；工作区说明、运行时上下文、技能目录和其他模型上下文注入仍保留在 Session 历史中，但不会显示成人类聊天气泡。模型思考时展示 reasoning 增量，生成答复时展示 text 增量，工具调用则显示带等待、成功或失败状态的生命周期卡片。客户端保留 mux 请求 id，把 `ask_user_question` 和审批请求渲染成可交互卡片，并通过 `/api/respond` 回传结果；因此 Agent 不会再因为不可见的交互请求而一直卡在执行中。

Excel 始终是文档权威。检查、有界读取、矩形字面值写入、清空、新建工作表和图表对象插入都在任务窗格内通过 `Excel.run` 执行。新建工作表会拒绝重复或非法名称，并可激活新工作表。图表插入使用明确的有界源区域和目标单元格，并返回所创建对象的名称、类型、标题与几何信息。Host 从不选择进程全局的“当前工作簿”。Provider 缺失、Session 未绑定、发送失败、取消、超时、Office.js 错误或断开都会以稳定失败结算，而不会悬挂。

开发 manifest 指向 `https://localhost:3010`；Vite 把 HTTP 和 WebSocket 流量代理到 3080 端口的 DSH Web。它把 DSH mux 与 host 下行通道的 Origin 改写成上游 Origin，同时为单独配置允许来源的 Excel Provider 保留浏览器 Origin。聊天下行和工作簿执行 socket 在 DSH 重启后都会使用有界退避自动重连。macOS 侧载助手把 manifest 复制到 Excel 的 `wef` 目录。本地 TLS 信任仍是需要用户批准的操作系统动作。

## 验证

Service 测试覆盖 Session 路由调用、能力不可用与工作簿断开失败、重复 Provider 拒绝、释放和预先取消。WebSocket 测试使用真实本地 socket 对覆盖关联成功和调用中断开结算。Add-in 测试覆盖新建工作表、图表对象创建与回读、不支持图表类型的拒绝、流式思考、最终答复替换、工具生命周期、持久化历史回放、注入上下文过滤和 mux 请求 id 保留。三个 Host 包通过 composite TypeScript 构建和类型感知 lint；Add-in 通过独立类型检查、聚焦测试与 Vite 生产构建。macOS manifest 已复制到 Excel 侧载目录。

## 曾考虑的替代方案

**从 Harness 进程自动化 Excel。** 拒绝，因为这会让工作簿身份、权限和生命周期变得隐式且依赖平台；Office.js 已经拥有文档内的权威上下文。

**把 Excel 逻辑直接放入 Web bundle。** 拒绝，因为普通浏览器不提供 Office.js，也不拥有任务窗格生命周期。

**复用聊天事件通道执行工具。** 拒绝，因为聊天 mux WebSocket 只允许服务端下行。工具执行需要请求／结果关联、取消和断开结算，因此使用独立的双向 WebSocket。

## 后果

打开已侧载 Add-in 会创建或恢复 DSH Session，并把完全相同的 Session 绑定到当前工作簿。Agent 可用六个有界工具检查和修改工作簿，而无需把 Excel 自动化权交给 Host。公式写入、格式、表格、数据透视表、图表样式重设与数据系列编辑、大区域分页、生产认证和 Windows 侧载自动化仍然暂缓。
