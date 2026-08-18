# Agent Note: Zoom 仅参会驱动

状态：已实现

[English](2026-08-18-zoom-presence-driver.md) | 中文

## 问题

进程拥有的会议参会者最初只识别 Google Meet 链接和页面控件。如果没有独立驱动就接受 Zoom 链接，系统要么会在不受支持的页面中使用 Google 选择器，要么会把 Remote 扩大为不受限制的浏览器启动器。

## 决策

`meetingPresence` Host 服务识别 `zoom.us` 子域上的规范 Zoom `/j/<meeting-id>` 和 `/wc/join/<meeting-id>` 链接。校验只保留可选的 `pwd` 查询值。通过校验的 Zoom 目标会选择一个独立打包的 Playwright worker；它打开 Zoom Web Client，输入明确披露的参会名称，提交 Join 操作，通过现有 worker 协议报告等待和已加入状态，并保持在线，直到被移除或用户明确要求离开。

Zoom 驱动沿用 Google 驱动的进程归属、单一活动参会者规则、清理过的子进程环境、有限诊断和完整进程树清理。它不包含录制、转写、截图上传、对象存储或持久会议状态。

浏览器交互参考了 [ScreenApp 以 MIT 许可证发布的 Zoom Bot](https://github.com/screenappai/meeting-bot/blob/main/src/bots/ZoomBot.ts)。驱动保留 Web Client 导航、顶层页面或 iframe 识别、访客名称输入和准入观察；录制、上传、队列和通知行为不属于该包。

## 考虑过的替代方案

**把 Zoom 链接发送给 Google worker。** 不采用，因为两个平台的链接格式、加入前控件、iframe 行为、准入信号和会议结束标志均不相同。

**运行完整 ScreenApp 服务。** 不采用，因为它的成功路径会录制和上传会议媒体，而这个能力只承诺参会。

**接受任意 Zoom 路径和查询字段。** 不采用，因为无关路径会把服务扩大为通用导航，而且访客准入不需要无关查询字段。

## 后果

“会议”面板在保留一个由 Host 拥有的生命周期的同时接受 Google Meet 和 Zoom 链接。需要密码的 Zoom 会议只有在共享链接携带 `pwd` 时才能成功；登录、验证码、企业策略和外部 UI 变化仍是明确失败情形。真实准入仍要求在线主持人允许明确披露身份的参会者加入。
