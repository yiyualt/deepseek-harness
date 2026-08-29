# `@deepseek-ai/dsh-tool-excel`

[English](README.md) | 中文

Excel 能力的模型侧 Consumer。它注册工作簿检查、新建工作表、区域读写与清空以及图表插入工具；每次调用都按照调用 Agent 的 Session id 路由，因此绝不会选择进程全局的“当前工作簿”。修改操作会返回 Office.js 回读数据，而不是仅凭调用就假设成功。

## 模型体验

### 工作簿工具

#### 模型看到什么

六个使用有界 A1 区域的原生工具 schema：`excel_inspect`、`excel_read_range`、`excel_write_range`、`excel_clear_range`、`excel_create_worksheet` 和 `excel_insert_chart`，并提示模型在工作簿结构未知时先检查再编辑。新建工作表可将分析与看板输出隔离，避免覆盖源数据。图表插入支持簇状柱形、簇状条形、折线、饼图、面积、圆环和散点对象，并要求明确源区域和目标位置。生成定义记录在[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-excel)中。结果以结构化 JSON 文本呈现。任务窗格断开会成为普通工具失败，提示模型和用户重新打开 Excel 连接。

#### Token 影响

每次请求包含六个工具 schema；只有调用时才增加取决于数据量的 JSON 结果。

#### KV Cache 影响

稳定的 schema 进入 system prompt。工具调用与结果追加到会话尾部。

## 已知限制与暂缓事项

- 图表插入会根据已有区域创建并定位新对象；图表样式重设、数据系列编辑、删除和图片导出暂缓。
- 公式写入、格式、表格、数据透视表、工作表重命名／删除／排序和大区域分页暂缓。
- 挂载该 Consumer 的组合会向所有 Agent 展示这些工具；执行仍要求任务窗格绑定到完全相同的 Session。
