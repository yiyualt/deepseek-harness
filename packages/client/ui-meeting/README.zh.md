# `@deepseek-ai/dsh-client-ui-meeting`

[English](README.md) | 中文

这个 Web 客户端插件向 `sidebar.footer.action` 贡献“会议”操作。该操作会打开一个包含 Google Meet 或 Zoom 链接输入框的模态面板，并渲染 Host 拥有的完整参会状态：空闲、正在启动、等待准入、已加入、正在离开、已离开或失败。参会者运行期间，侧栏按钮会持续显示活动标记；关闭面板不会让它离开。

插件调用 `meetingPresence` Remote，并订阅 `meeting-presence/change`，因此准入状态无需轮询即可抵达。每次打开面板也会读取当前 Host 快照，以恢复面板关闭或连接中断期间错过的状态。产品文案明确说明该参会者不会录制或上传会议内容。

## 模型体验

### 模型看到什么

没有内容。该面板是用户控件，不添加任何模型可见输入。

### Token 影响

无。

### KV Cache 影响

无。

## 已知限制与暂缓工作

- 面板只接受 Google Meet，不提供平台选择器。
- 状态属于一个 Host 进程，而不是某个 session 或工作区。
- 除 Host 返回的有界错误消息外，界面不展示更多浏览器诊断。
