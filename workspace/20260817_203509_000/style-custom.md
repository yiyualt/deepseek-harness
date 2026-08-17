---
font-family:
  - system-ui
---

# AI 技术底座单页视觉规范

## 主题与受众

- 主题：AI 技术底座——大脑（模型）与海马体（RAG）协同作战。
- 受众：工程机械企业集团高层。
- 气质：商务科技、严谨、工业、克制；中心辐射与左右对称；高信息密度但不拥挤。
- 图形：核心架构与全部连线使用内联 SVG；使用工业线框、节点、微型网格和机械刻度，不使用照片。

## 禁止项

- 禁止大面积渐变、霓虹光晕、玻璃拟态、卡通图标、圆润胶囊堆叠。
- 禁止绿色或暖色作为主色；禁止无语义装饰抢占主体。
- 禁止长段落；可见文字只使用关键词与短句。

## 色彩与版式

- 背景为深海军蓝，卡片为蓝灰深色表面，边框与分割线使用银灰。
- 冷青蓝仅用于关键流向、中心协同与重点文字。
- 左右侧栏等宽；中心核心区略宽；顶端业务场景为一条轻量横向支撑带；底部总结条收口。
- 锐利 2–6px 圆角，1px 工业线框，无投影或仅极轻阴影。
- 标题 31–35px；模块标题 18–21px；正文 13–16px；标签 12–14px。

## CSS 变量

```css
--color-bg: #071426;
--color-surface: #0D2036;
--color-surface-2: #132B43;
--color-text: #F3F7FA;
--color-muted: #A9B7C6;
--color-silver: #C6D0DA;
--color-line: #4F6478;
--color-accent: #36BCE8;
--color-accent-2: #6D9FC5;
--font-family: system-ui;
--radius-card: 4px;
--shadow-card: 0 4px 14px rgba(0, 0, 0, 0.18);
--content-density: compact;
```

## 全局 CSS 规则

```css
.ppt-slide { background: var(--color-bg); color: var(--color-text); font-family: var(--font-family); }
.page-content { width: 100%; height: 100%; position: relative; }
.panel { background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-card); }
.panel-strong { background: var(--color-surface-2); border: 1px solid var(--color-accent-2); border-radius: var(--radius-card); }
.muted { color: var(--color-muted); }
.accent { color: var(--color-accent); }
```

## 图表约束

- 架构图使用单个内联 SVG，`viewBox="0 0 1220 510"`，保持矢量。
- SVG 字体栈完整复用 `system-ui`，由演示环境选择可用中文字体。
- 连线使用清晰箭头：数据工程 → 大脑；知识工程 → 海马体；海马体 ↔ 大脑；四个核心模块共同向上支撑业务场景。
- 不使用 ECharts，不使用 canvas，不使用渐变填充。
