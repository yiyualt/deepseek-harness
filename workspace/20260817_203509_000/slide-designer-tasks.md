# slide-designer生成任务清单

> 每个slide-designer subagent：先完整阅读文首「执行流程」与「## 通用规范」，再找到自己负责的 `### P{N}` 段，按其指定的输出路径、内容素材、图表规范要求执行。

## 执行流程（所有页必读）

1. 先完整阅读文首「执行流程」与「## 通用规范」。
2. 读取视觉风格文件（路径见「环境准备」），建立本次演示唯一的配色/字体/视觉权威。
3. 按当前分支处理模板/骨架：
   - 预设风格：目标 `page-N.pptx.html` 已由 `ensure-output-dir` 预铺；直接编辑该文件，**仅替换 `{{}}` 占位符**，禁止从源模板再次复制覆盖或重写标题栏/页脚/CSS/装饰/SVG/`@layer` 骨架。
   - custom（`references/styles/custom` 预铺）：custom 骨架不预设任何结构与样式；将风格文件的 CSS 变量逐字填入 `{{THEME_CSS_VARIABLES}}`、全局 CSS 规则块逐字填入 `{{THEME_CSS_RULES}}`（未提供时替换为空），页面全部内容（含标题与页脚）在 `{{PAGE_CONTENT}}` 内依据风格文件自由设计。
   - 自定义模板（`--template`）：必须首先读取模板文件，理解页面结构后填充 `{{PAGE_TITLE}}` / `{{PAGE_CONTENT}}` / `{{PAGE_FOOTER}}` 等占位符；禁止修改模板标题栏、页脚、CSS 定义。
   - 无模板：读取 /Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/designer.md 与风格文件，自行设计整页 HTML，但须使用标准 `<div class="ppt-slide flex flex-col">` 容器与全局 CSS 约束。
4. 找到自己负责的 `### P{N}` 段，按其指定的输出路径、内容素材、图表规范要求执行；内容页默认按图表候选页处理，必读 /Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/designer.md 的图表与数据可视化章节。
5. 写 HTML 前先按 /Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/designer.md 的「页面内容预算契约」制定预算（页面类型/密度/区域比例/卡片上限/最小字号/至少 8% 垂直缓冲），作为生成 HTML 的前置决策。
6. 单次生成并写入指定输出文件；完成后直接返回，不执行生成后布局检查、重排或修复重试。

## 通用规范（所有页必读）

### 禁止与用户交互
- 所有设计规范、视觉风格、内容素材的路径均已由主控提供，直接读取执行。
- 不得向用户提问、确认风格选择、请求补充设计参数。
- 若风格文件路径为空，自行根据主题设计配色和字体，不询问用户。

### 环境准备（必读）
- 模板文件：通用模板目录：/Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/styles/custom；模板已由 ensure-output-dir 预铺到目标 pages/，直接编辑 page-N.pptx.html
- 模板目录：/Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/styles/custom
- 设计规范：/Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/designer.md
- 视觉风格：/Users/yuyi/Pyleaf/deepseek-harness/workspace/20260817_203509_000/style-custom.md
- 大纲：/Users/yuyi/Pyleaf/deepseek-harness/workspace/20260817_203509_000/outline.md
- 图片映射：（本次未传入图片映射，使用无图片布局，不得自行搜索或生成替代内容图）

### 约束要求
- **custom 自由脚手架**：直接编辑已预铺目标文件，不得从源模板再次复制覆盖；custom 骨架不预设任何结构与样式，页面结构、布局、配色、字号全部依据视觉风格文件自由设计
- **主题唯一来源**：从视觉风格文件逐字填充 `{{THEME_CSS_VARIABLES}}`（CSS 变量）与 `{{THEME_CSS_RULES}}`（全局样式规则；风格文件未提供时替换为空），不得逐页重新选择全局颜色或字体
- **硬约束不可破坏**：`.ppt-slide` 1280×720 画布、`@layer utilities` 安全块、`theme-contract` 插槽逐字保留；页面全部内容（含标题与页脚）填入 `{{PAGE_CONTENT}}`
- **配色/字体唯一权威 = 视觉风格文件**：references/designer.md 中的任何示例配色（配色表、`tailwind.config` 示例、ECharts `color`/`borderRadius` 等）仅示意代码结构，**严禁照抄其 hex 值**；指定了视觉风格文件时，配色/字体/圆角/阴影一律以风格文件为准，与本文档示例冲突时以风格文件为准。
- **style.md frontmatter 的 font-family 是唯一字体权威**：全文只允许一个完整字体栈；标题、正文、SVG 与 ECharts 必须复用同一字体栈，不得另设 heading/body/chart 字体分支。
- 严格遵循视觉风格文件中的配色方案、字体和组件样式。
- 禁止使用文件中未定义的颜色或字体。
- 图表候选页必须遵循 references/designer.md 的图表规范与 JavaScript 安全编码规范；结构性页面无需阅读该章节。
- **容器与防溢出（强制）**：必须使用标准 `<div class="ppt-slide flex flex-col" type="...">` 容器，并在 `<head>` 内完整包含预铺模板中的「防溢出硬性约束 → 全局 CSS 约束」（custom 模板为 `@layer utilities` 安全块）整段。禁止自创简化容器（如裸 `style="height:720px"` / `.slide-container`），否则全局防溢出失效、内容溢出。
- **逐图槽位契约（强制）**：本页映射存在图片时，图片容器比例必须遵循 `targetAspectRatio`；`fit=cover` 使用 `object-fit: cover`，`fit=contain` 使用 `object-fit: contain`，并将 `subjectPosition` 映射为 `object-position`。不得把所有图片统一设为 `contain`，也不得擅自把竖图、横条图改成 16:9 容器。
- **custom 首尾页图片契约**：本次没有图片映射；封面和结束页必须将 `STRUCTURAL_IMAGE_PRESENT` 填为 `false`，并将 `STRUCTURAL_IMAGE_PATH` / `ALT` 置空，保留模板纯色 fallback，不得残留占位符。
- **可见文字来源契约（强制）**：所有观众可见文字只能来自用户原始需求、outline.md、本页 research-P{N}.md（结构页无 research）或已批准模板的固定文案。禁止为营造氛围自行添加与叙事无关的英文、随机数字或制作编号。
- **风格术语不得上屏（强制）**：视觉风格文件中的胶片型号、摄影/曝光/镜头参数、字体名、色板名、模型或 prompt 关键词只用于视觉实现，不得生成为 HTML 文本节点。除非 outline 明确要求，禁止出现 REEL / TAKE / FRAME / EXP. / SHUTTER / KODAK / FUJIFILM 等制作元数据。
- **页面纵向结构（强制）**：内容页的 header / main / footer 必须参与同一个纵向 flex 布局；footer 不得使用 `position:absolute` / `fixed` 脱离文档流。建议标记 `main[data-pptx-role="content"]`、`footer[data-pptx-role="footer"]`，背景/纯装饰节点标记 `data-pptx-role="background"` / `decoration`。
- **高度预算（强制）**：`main`、`.layout` 等页面核心聚合容器不得通过固定 px 高度或 `height:auto; min-height:...` 把超量内容继续向 720px 画布下方扩张。图片槽、图表槽和卡片内部允许按预算使用明确尺寸，但所有区域总高必须受 main 实际可用高度约束，并保留至少 8% 缓冲。

## 逐页任务

### P1  [内容页 / technology]
- 输出文件（最高优先级，禁止违反）：/Users/yuyi/Pyleaf/deepseek-harness/workspace/20260817_203509_000/pages/page-1.pptx.html
- 内容素材：/Users/yuyi/Pyleaf/deepseek-harness/workspace/20260817_203509_000/outline.md + /Users/yuyi/Pyleaf/deepseek-harness/workspace/20260817_203509_000/research-P1.md
- 图表规范：需要（内容页默认按图表候选页处理，必读 /Users/yuyi/Pyleaf/deepseek-harness/.agents/skills/pptx-craft/references/designer.md 的图表与数据可视化章节）
- 任务：你负责生成第 1 页的 HTML 幻灯片。仅生成该页面，确保内容完整提取自本页研究素材 research-P1.md。本页所有可见文字只能来自 outline.md 与 research-P1.md，不得把风格描述或制作元数据当作文案。
