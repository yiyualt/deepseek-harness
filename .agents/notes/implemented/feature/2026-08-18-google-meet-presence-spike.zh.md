# Agent Note: Google Meet 仅参会穿刺

Status: implemented

[English](2026-08-18-google-meet-presence-spike.md) | 中文

## 问题

Web 应用没有让用户提交会议链接，并在会议内观察到 Harness 自有参会者的路径。如果在证明准入以前就同时建设录制、转写、存储、多平台路由和帐号身份，会把相互独立的失败域混在一起，也会在录制行为尚无已评审用途时捕获会议内容。

## 决策

Web bundle 挂载一个进程级 `meetingPresence` Host 服务，以及一个 `ui-meeting` 侧栏贡献。首个提供方只接受规范的 Google Meet 链接，并通过现有 subprocess 服务启动随包 Playwright worker。worker 使用全新的 Chrome 上下文，以明确披露的名称 `DeepSeek AI 会议助手` 请求访客准入，并在会议中保持在线；它不录制、不转写、不截取会议截图，也不上传会议内容。

Host 拥有参会者生命周期，并发布 `starting`、`waiting-admission`、`joined`、`leaving`、`left` 和 `failed` 的完整快照。Web Remote 将这些快照转发给面板；面板打开时也会读取当前快照，使重连和关闭期间错过状态的界面无需轮询即可收敛。每个 Host 进程最多存在一个参会者。

Google Meet 链接在进程创建前校验，只接受 `https://meet.google.com/xxx-xxxx-xxx`。浏览器执行继承 subprocess 提供方清理过的环境变量。用户要求离开和插件释放都会终止完整浏览器进程树并等待它静止。

浏览器交互参考 [ScreenApp 以 MIT 许可证发布的 meeting-bot](https://github.com/screenappai/meeting-bot)，但交付的 worker 只保留访客准入和在线能力。它没有引入 ScreenApp 的录制、上传器、Redis、存储、后端 Token 或隐蔽名称行为。

## 曾考虑的替代方案

**原样运行 ScreenApp meeting-bot。** 否决，因为它在成功加入后会录制会议并尝试上传；缺少存储凭证只能阻止交付，不能阻止捕获。

**在第一刀实现录制和转写。** 否决，因为可见准入是第一个独立产品事实。捕获同意、媒体传输、保留策略和转写持久性需要在准入可靠以后单独决策。

**从腾讯会议开始。** 此次穿刺否决该方案，因为已调研的 `tmeet` CLI 管理会议和产物，但不会创建可见的实时参会者；参考实现则为 Google Meet 提供了具体访客路径。

**允许任意会议链接。** 否决，因为 worker 会因此成为通用浏览器导航入口，而且它的选择器只适用于 Google Meet。

## 后果

用户获得一条小型端到端路径：打开“会议”，提交 Google Meet 链接，允许明确披露身份的参会者加入，观察已加入状态，并让它离开。这一刀证明 UI、Remote 与受管浏览器之间的归属关系，同时不创建会议录制或持久 session 事实。

Google 驱动依赖 Google Meet 的访客页面结构和已安装的 Chrome channel，因此外部界面变化仍可能破坏准入。同一套生命周期也承载 [Zoom 仅参会驱动](2026-08-18-zoom-presence-driver.md)。要求登录的会议、专用机器人帐号、Teams、腾讯会议、并发、持久化以及任何媒体处理都按设计保持缺席。
