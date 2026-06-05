import { BLANK_RULE } from "@/lib/default-rule";
import { ParseRule, ParsedSource } from "@/lib/types";

type AiRuleResponse = {
  rule: ParseRule;
  notes: string[];
};

export async function generateRuleWithLLM(source: ParsedSource): Promise<AiRuleResponse> {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-5.5";

  if (!baseUrl || !apiKey) {
    return {
      rule: {
        ...BLANK_RULE,
        name: `${source.fileName} 推荐规则`,
        description: "未配置 LLM 环境变量，已生成可编辑的通用表格规则草案。"
      },
      notes: ["服务端未配置 LLM_BASE_URL / LLM_API_KEY，当前为本地兜底规则。"]
    };
  }

  const sample = compactSourceForPrompt(source);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是物流出库单解析规则架构师。你的任务是根据文件样本生成通用 JSON 解析规则，禁止直接输出业务数据，禁止使用文件名判断。只返回 JSON。"
        },
        {
          role: "user",
          content: buildPrompt(sample)
        }
      ]
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    throw new Error(`LLM 请求失败：${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 没有返回规则内容");

  const parsed = safeJson(content);
  const rule = sanitizeRule(parsed.rule ?? parsed, source.fileName);
  return {
    rule,
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : ["AI 已生成规则草案，请预览测试后保存。"]
  };
}

function compactSourceForPrompt(source: ParsedSource) {
  if (source.kind === "text") {
    return {
      kind: source.kind,
      fileName: source.fileName,
      text: source.text.slice(0, 12000)
    };
  }
  return {
    kind: source.kind,
    fileName: source.fileName,
    sheets: source.sheets.slice(0, 8).map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows.slice(0, 25).map((row) => row.slice(0, 45))
    }))
  };
}

function buildPrompt(sample: unknown) {
  return `请分析下面的 Excel/Word/PDF 抽样内容，生成一条可编辑解析规则。规则必须符合此 TypeScript 语义：

ParseRule = {
  name: string;
  version: 2;
  source: "workbook" | "text" | "any";
  sheetMode?: "first" | "all";
  common?: { 字段?: Extractor };
  defaults?: { 字段?: string };
  strategies: Strategy[];
  assumptions?: { field: string; reason: string; confidence: number }[];
}

字段只能使用：externalCode, storeName, receiverName, receiverPhone, receiverAddress, skuCode, skuName, quantity, spec, remark。

支持的 Strategy：
1. table：通过 header.findByKeywords 找表头，通过 columns 的 candidates/index 映射列，common 可用 labelRight/cell/regex/sheetName/static 抽取尾部或头部公共信息。
2. matrix：将横向门店/日期列转置为行，pivot.field 常用 storeName，cell.mode 可为 quantity 或 items。
3. cards：用 boundary.pattern 切卡片，每张卡片内找小表。
4. textSegments：用 segmentBoundary 分段，再用 commonPatterns 和 itemLinePattern 抽纯文本/PDF 文本。

Extractor 可用：
{ "type":"static", "value":"..." }
{ "type":"sheetName" }
{ "type":"cell", "row":0, "column":0 }
{ "type":"labelRight", "label":"收货人", "rowStart":0, "rowEnd":20, "valueOffset":1 }
{ "type":"regex", "pattern":"收货人[:：]([^\\\\n]+)", "group":1 }

请返回 JSON：
{
  "rule": ParseRule,
  "notes": ["哪些映射是推测的、需要人工确认"]
}

要求：
- 规则名不要包含密钥或隐私。
- 不要出现文件名判断。
- 对推测字段写入 assumptions。
- 尽量通过 candidates 而不是固定列号，只有非标准布局才使用 index。

样本如下：
${JSON.stringify(sample, null, 2)}`;
}

function safeJson(content: string) {
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim() : trimmed;
  return JSON.parse(jsonText);
}

function sanitizeRule(input: Partial<ParseRule>, fileName: string): ParseRule {
  return {
    ...BLANK_RULE,
    ...input,
    name: input.name || `${fileName} 推荐规则`,
    version: 2,
    strategies: Array.isArray(input.strategies) && input.strategies.length ? input.strategies : BLANK_RULE.strategies
  };
}
