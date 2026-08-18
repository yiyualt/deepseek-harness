# `@deepseek-ai/dsh-host-meeting-presence`

[English](README.md) | 中文

这个 Web Host 服务在整个进程中管理一个仅参会的 Google Meet 或 Zoom 参与者。`meetingPresence` Remote 校验平台链接，通过 `ctx.subprocess` 启动对应的随包 Playwright 驱动，并通过 `meeting-presence/change` 发布完整状态快照。每个驱动都会打开全新的 Chrome 上下文，输入配置的参会名称，请求主持人准入，然后留在会议中，直到用户要求离开、会议将它移除，或 Host 卸载该插件。

驱动不包含录制、转写、截图上传或对象存储路径。子进程的环境变量由 subprocess 提供方清除凭证形态的值。链接校验只接受规范的 Google Meet 链接，以及 Zoom `/j/` 或 `/wc/join/` 链接；其他 Host 和路径会在浏览器启动前失败，因此服务不能作为通用网页导航器使用。Zoom 链接会保留 `pwd` 查询值，并移除无关查询字段。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `botName` | `DeepSeek AI 会议助手` | 参会者看到的名称。 |
| `joinTimeoutMs` | `120000` | 等待主持人准入的最长时间。 |
| `statusPollMs` | `500` | worker 检查准入和移除状态的间隔。 |
| `processGraceMs` | `5000` | 子进程从 TERM 升级到 KILL 的清理宽限时间。 |
| `headless` | `false` | Chrome 是否以无可见窗口方式启动。 |
| `chromeExecutablePath` | 未设置 | 明确的 Chrome 路径；未设置时选择 Playwright 安装的 Chrome channel。 |

同一时间只能运行一个参会者。当当前状态为 `starting`、`waiting-admission`、`joined` 或 `leaving` 时，`join` 会拒绝新请求。`leave` 请求终止整个进程树，并在完整进程树退出后返回。插件释放会执行同样的等待式清理，并禁止发布延迟到达的状态变化。

浏览器交互参考了 [ScreenApp 以 MIT 许可证发布的 meeting-bot](https://github.com/screenappai/meeting-bot)所展示的公开 Google Meet 和 Zoom 自动化方式，并将范围收窄到准入和在线状态。

## 模型体验

### 模型看到什么

没有内容。该服务由用户通过 Web Remote 驱动，不添加工具、prompt 段落或 session 事件。

### Token 影响

无。

### KV Cache 影响

无。

## 已知限制与暂缓工作

- Google 或 Zoom 可能改变访客加入前页面，或拒绝自动化浏览器；驱动会返回可见错误码，不会回退到已登录帐号。
- 要求平台登录的会议会被拒绝。Zoom 密码只有在共享链接携带 `pwd` 时才受支持；专用帐号身份和企业策略支持仍暂缓。
- 参会者是进程级单任务。按工作区归属、Host 重启后的恢复以及多会议并发仍暂缓。
- 该提供方不接受 Microsoft Teams 或腾讯会议。
