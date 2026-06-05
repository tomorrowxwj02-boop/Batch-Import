# 万能导入 V2

智能多格式批量下单系统，使用 Next.js App Router + TypeScript 实现。

## 功能覆盖

- Excel / Word / PDF 文件上传，前端预处理为统一样本。
- 可持久化解析规则管理：创建、编辑、删除、复制、手动选择。
- AI 辅助生成规则：模型只生成 JSON 规则草案，用户确认后保存，解析执行由规则引擎完成。
- 通用规则引擎覆盖表格、矩阵转置、多 Sheet、卡片式、纯文本/PDF 分段等结构。
- 类 Excel 数据预览：固定表头、横向滚动、单元格编辑、Tab/Enter 快捷切换。
- 全量错误展示、实时校验、同批次/历史外部编码重复检测。
- 提交下单写入 Neon PostgreSQL，历史运单列表支持搜索与分页。
- 预览数据可导出为 Excel。

## 环境变量

复制 `.env.example` 为 `.env.local` 并配置：

```bash
DATABASE_URL="postgresql://..."
LLM_BASE_URL="https://988665.xyz/v1"
LLM_API_KEY="sk-..."
LLM_MODEL="gpt-5.5"
```

API Key 只通过服务端环境变量读取，不会暴露到浏览器，也不应提交到 Git。

## 本地运行

```bash
pnpm install
pnpm dev
```

## 大模型调用说明

系统调用 OpenAI-compatible `/chat/completions` 接口。Prompt 要求模型扮演“物流出库单解析规则架构师”，根据文件样本输出 JSON 规则，而不是直接输出运单数据。规则草案包含 `assumptions` 和 `notes`，用于标注推测映射，用户可在页面 JSON 编辑器中微调、试解析、确认后保存。

## 规则引擎说明

规则 DSL 支持四类策略：

- `table`：扫描表头、映射列、提取头尾公共信息。
- `matrix`：将门店/日期横向列转置为出库行，并支持复合单元格拆分。
- `cards`：按边界行切分非标准卡片，再解析卡片内小表。
- `textSegments`：用于 Word/PDF 纯文本，按分隔线/正则切分订单并抽取物品行。

新增格式时只需新建或 AI 生成规则，应用代码无需增加文件名判断。
