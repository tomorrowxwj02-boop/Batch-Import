import {
  CellValue,
  ColumnSelector,
  Extractor,
  FieldKey,
  OrderRow,
  ParseRule,
  ParseStrategy,
  ParsedSource,
  StopRule,
  TextSource,
  WorkbookSource
} from "@/lib/types";
import { normalizeText, toText, uid } from "@/lib/utils";

const FIELDS: FieldKey[] = [
  "externalCode",
  "storeName",
  "receiverName",
  "receiverPhone",
  "receiverAddress",
  "skuCode",
  "skuName",
  "quantity",
  "spec",
  "remark"
];

type SheetContext = WorkbookSource["sheets"][number];
type RowObject = Partial<Record<FieldKey, string>> & {
  sourceSheet?: string;
  sourceRow?: number;
};

export type ParseResult = {
  rows: OrderRow[];
  warnings: string[];
  metrics: {
    strategies: number;
    sourceRows: number;
    durationMs: number;
  };
};

export function parseWithRule(source: ParsedSource, rule: ParseRule): ParseResult {
  const started = performance.now();
  const warnings: string[] = [];
  let rowObjects: RowObject[] = [];

  const activeStrategies = rule.strategies.filter((strategy) => strategy.enabled !== false);

  for (const strategy of activeStrategies) {
    if (source.kind === "workbook" && acceptsWorkbook(strategy)) {
      rowObjects = rowObjects.concat(parseWorkbookStrategy(source, rule, strategy, warnings));
    }
    if (source.kind === "text" && strategy.type === "textSegments") {
      rowObjects = rowObjects.concat(parseTextStrategy(source, rule, strategy));
    }
  }

  const rows = rowObjects
    .map((row, index) => normalizeRow(row, index))
    .filter((row) => toText(row.skuCode) || toText(row.skuName) || toText(row.quantity));

  return {
    rows,
    warnings,
    metrics: {
      strategies: activeStrategies.length,
      sourceRows: source.kind === "workbook" ? source.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0) : 0,
      durationMs: Math.round(performance.now() - started)
    }
  };
}

function acceptsWorkbook(strategy: ParseStrategy) {
  return strategy.type === "table" || strategy.type === "matrix" || strategy.type === "cards";
}

function parseWorkbookStrategy(
  source: WorkbookSource,
  rule: ParseRule,
  strategy: ParseStrategy,
  warnings: string[]
): RowObject[] {
  if (strategy.type === "textSegments") return [];

  const sheets = chooseSheets(source, strategy.sheets ?? rule.sheetMode ?? "first");
  const rows: RowObject[] = [];

  sheets.forEach((sheet) => {
    if (strategy.type === "table") rows.push(...parseTableSheet(sheet, rule, strategy, warnings));
    if (strategy.type === "matrix") rows.push(...parseMatrixSheet(sheet, rule, strategy, warnings));
    if (strategy.type === "cards") rows.push(...parseCardSheet(sheet, rule, strategy, warnings));
  });

  return rows;
}

function chooseSheets(source: WorkbookSource, mode: NonNullable<ParseStrategy["sheets"]> | ParseRule["sheetMode"]) {
  if (Array.isArray(mode)) {
    const wanted = new Set(mode);
    return source.sheets.filter((sheet) => wanted.has(sheet.name));
  }
  if (mode === "all") return source.sheets;
  return source.sheets.slice(0, 1);
}

function parseTableSheet(
  sheet: SheetContext,
  rule: ParseRule,
  strategy: Extract<ParseStrategy, { type: "table" }>,
  warnings: string[]
) {
  const headerIndex =
    typeof strategy.header.rowIndex === "number"
      ? strategy.header.rowIndex
      : findHeaderRow(sheet.rows, strategy.header.findByKeywords ?? [], strategy.header.maxScanRows ?? 30);

  if (headerIndex < 0) {
    warnings.push(`${sheet.name} 未找到表头，已跳过表格策略`);
    return [];
  }

  const header = sheet.rows[headerIndex] ?? [];
  const dataStart = headerIndex + (strategy.dataStartRowOffset ?? 1);
  const common = collectCommon(sheet, rule, strategy, undefined);
  const rows: RowObject[] = [];

  for (let rowIndex = dataStart; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (isEffectivelyEmpty(row)) continue;
    if (shouldStop(row, header, strategy.stopWhen)) break;
    if (matchesAnyCell(row, strategy.skipRowsWhen?.textMatches ?? [])) continue;

    const record = materializeRecord({
      row,
      header,
      sheet,
      rowIndex,
      columns: strategy.columns,
      defaults: { ...rule.defaults, ...strategy.defaults },
      common
    });

    if (strategy.skipRowsWhen?.requiredAny?.length) {
      const ok = strategy.skipRowsWhen.requiredAny.some((field) => toText(record[field]));
      if (!ok) continue;
    }

    rows.push(record);
  }

  return aggregateIfNeeded(rows, strategy.aggregateBy);
}

function parseMatrixSheet(
  sheet: SheetContext,
  rule: ParseRule,
  strategy: Extract<ParseStrategy, { type: "matrix" }>,
  warnings: string[]
) {
  const header = sheet.rows[strategy.headerRow] ?? [];
  if (!header.length) {
    warnings.push(`${sheet.name} 矩阵表头为空，已跳过矩阵策略`);
    return [];
  }

  const pivotHeaderRow = sheet.rows[strategy.pivot.headerRow ?? strategy.headerRow] ?? [];
  const common = collectCommon(sheet, rule, strategy, undefined);
  const start = strategy.pivot.startColumn;
  const end = Math.min(strategy.pivot.endColumn ?? pivotHeaderRow.length - 1, pivotHeaderRow.length - 1);
  const rows: RowObject[] = [];

  for (let rowIndex = strategy.dataStartRow; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (isEffectivelyEmpty(row)) continue;
    if (shouldStop(row, header, strategy.stopWhen)) break;

    const base = materializeRecord({
      row,
      header,
      sheet,
      rowIndex,
      columns: strategy.rowFields,
      defaults: { ...rule.defaults, ...strategy.defaults },
      common
    });

    for (let colIndex = start; colIndex <= end; colIndex += 1) {
      const raw = row[colIndex];
      const cellText = toText(raw);
      if (!cellText) continue;
      const pivotLabel = toText(pivotHeaderRow[colIndex]);
      if (!pivotLabel) continue;

      if (strategy.cell.mode === "quantity") {
        const quantity = numericText(cellText);
        if (!quantity) continue;
        rows.push({
          ...base,
          [strategy.pivot.field]: `${strategy.pivot.valuePrefix ?? ""}${pivotLabel}`,
          quantity,
          sourceSheet: sheet.name,
          sourceRow: rowIndex + 1
        });
      } else {
        const itemRows = splitCompositeItems(cellText, strategy.cell.itemPattern);
        itemRows.forEach((item, itemIndex) => {
          rows.push({
            ...base,
            [strategy.pivot.field]: `${strategy.pivot.valuePrefix ?? ""}${pivotLabel}`,
            skuName: item.name || base.skuName || "",
            skuCode: item.code || base.skuCode || `${pivotLabel}-${rowIndex + 1}-${itemIndex + 1}`,
            quantity: item.quantity,
            spec: item.spec || base.spec || "",
            sourceSheet: sheet.name,
            sourceRow: rowIndex + 1
          });
        });
      }
    }
  }

  return rows;
}

function parseCardSheet(
  sheet: SheetContext,
  rule: ParseRule,
  strategy: Extract<ParseStrategy, { type: "cards" }>,
  warnings: string[]
) {
  const boundaryRe = new RegExp(strategy.boundary.pattern);
  const boundaryRows = sheet.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => boundaryRe.test(toText(row[strategy.boundary.column ?? 0]) || row.map(toText).join(" ")));

  if (!boundaryRows.length) {
    warnings.push(`${sheet.name} 未识别到卡片边界，已跳过卡片策略`);
    return [];
  }

  const rows: RowObject[] = [];
  boundaryRows.forEach(({ index: start }, cardIndex) => {
    const end = boundaryRows[cardIndex + 1]?.index ?? sheet.rows.length;
    const cardRows = sheet.rows.slice(start, end);
    const cardSheet: SheetContext = { name: sheet.name, rows: cardRows };
    const headerOffset =
      typeof strategy.tableHeader.offsetFromBoundary === "number"
        ? strategy.tableHeader.offsetFromBoundary
        : findHeaderRow(cardRows, strategy.tableHeader.findByKeywords ?? [], strategy.tableHeader.maxRows ?? 12);

    if (headerOffset < 0) return;
    const header = cardRows[headerOffset] ?? [];
    const common = collectCommon(cardSheet, rule, strategy, {
      ...strategy.common,
      ...strategy.cardCommon
    });

    for (let localRow = headerOffset + 1; localRow < cardRows.length; localRow += 1) {
      const row = cardRows[localRow] ?? [];
      if (isEffectivelyEmpty(row)) continue;
      const record = materializeRecord({
        row,
        header,
        sheet,
        rowIndex: start + localRow,
        columns: strategy.columns,
        defaults: { ...rule.defaults, ...strategy.defaults },
        common
      });
      if (toText(record.skuCode) || toText(record.skuName)) rows.push(record);
    }
  });

  return rows;
}

function parseTextStrategy(source: TextSource, rule: ParseRule, strategy: Extract<ParseStrategy, { type: "textSegments" }>) {
  const text = source.text;
  const boundary = strategy.segmentBoundary ? new RegExp(strategy.segmentBoundary, "m") : /\n\s*\n\s*\n+/;
  const segments = text
    .split(boundary)
    .map((part) => part.trim())
    .filter(Boolean);

  const rows: RowObject[] = [];
  const commonForWholeText = evaluateTextCommon(text, rule.common);

  segments.forEach((segment, segmentIndex) => {
    const common = {
      ...rule.defaults,
      ...strategy.defaults,
      ...commonForWholeText,
      ...evaluateTextCommon(segment, strategy.common),
      ...evaluateRegexFields(segment, strategy.commonPatterns)
    };
    const itemRe = new RegExp(strategy.itemLinePattern, "gim");
    for (const match of segment.matchAll(itemRe)) {
      rows.push({
        ...common,
        skuCode: pickGroup(match, "skuCode", 1) || common.skuCode || "",
        skuName: pickGroup(match, "skuName", 2) || common.skuName || "",
        spec: pickGroup(match, "spec", 3) || common.spec || "",
        quantity: pickGroup(match, "quantity", 4) || common.quantity || "",
        externalCode: common.externalCode || `TXT-${segmentIndex + 1}`,
        sourceSheet: "文本",
        sourceRow: segmentIndex + 1
      });
    }
  });

  return rows;
}

function findHeaderRow(rows: CellValue[][], keywords: string[], maxScanRows: number) {
  if (!keywords.length) return 0;
  let bestIndex = -1;
  let bestScore = 0;
  const normalizedKeywords = keywords.map(normalizeText);
  for (let index = 0; index < Math.min(rows.length, maxScanRows); index += 1) {
    const haystack = rows[index].map(normalizeText).join("|");
    const score = normalizedKeywords.reduce((sum, keyword) => (haystack.includes(keyword) ? sum + 1 : sum), 0);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestScore > 0 ? bestIndex : -1;
}

function collectCommon(
  sheet: SheetContext,
  rule: ParseRule,
  strategy: Exclude<ParseStrategy, Extract<ParseStrategy, { type: "textSegments" }>>,
  override?: Partial<Record<FieldKey, Extractor>>
) {
  const commonExtractors = { ...rule.common, ...strategy.common, ...override };
  const common: Partial<Record<FieldKey, string>> = {};
  FIELDS.forEach((field) => {
    const extractor = commonExtractors[field];
    if (extractor) common[field] = evaluateExtractor(extractor, sheet);
  });
  return common;
}

function materializeRecord(input: {
  row: CellValue[];
  header: CellValue[];
  sheet: SheetContext;
  rowIndex: number;
  columns: Partial<Record<FieldKey, ColumnSelector>>;
  defaults?: Partial<Record<FieldKey, string>>;
  common?: Partial<Record<FieldKey, string>>;
}) {
  const record: RowObject = {
    ...input.defaults,
    ...input.common,
    sourceSheet: input.sheet.name,
    sourceRow: input.rowIndex + 1
  };
  FIELDS.forEach((field) => {
    const selector = input.columns[field];
    if (!selector) return;
    const columnIndex = resolveColumn(selector, input.header);
    if (columnIndex >= 0) record[field] = toText(input.row[columnIndex]);
  });
  return record;
}

function resolveColumn(selector: ColumnSelector, header: CellValue[]) {
  if (typeof selector.index === "number") return selector.index;
  const candidates = [selector.header, ...(selector.candidates ?? [])].filter(Boolean).map(normalizeText);
  if (!candidates.length) return -1;
  let fallback = -1;
  for (let index = 0; index < header.length; index += 1) {
    const cell = normalizeText(header[index]);
    if (!cell) continue;
    if (candidates.some((candidate) => cell === candidate)) return index;
    if (fallback < 0 && candidates.some((candidate) => cell.includes(candidate) || candidate.includes(cell))) {
      fallback = index;
    }
  }
  return fallback;
}

function evaluateExtractor(extractor: Extractor, sheet: SheetContext) {
  if (extractor.type === "static") return extractor.value;
  if (extractor.type === "sheetName") return sheet.name;
  if (extractor.type === "cell") return toText(sheet.rows[extractor.row]?.[extractor.column]);
  if (extractor.type === "labelRight") {
    const occurrence = extractor.occurrence ?? 1;
    let found = 0;
    const start = extractor.rowStart ?? 0;
    const end = Math.min(extractor.rowEnd ?? sheet.rows.length - 1, sheet.rows.length - 1);
    for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
      const row = sheet.rows[rowIndex] ?? [];
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        if (normalizeText(row[colIndex]).includes(normalizeText(extractor.label))) {
          found += 1;
          if (found === occurrence) return toText(row[colIndex + (extractor.valueOffset ?? 1)]);
        }
      }
    }
  }
  if (extractor.type === "regex") {
    const text = sheet.rows.map((row) => row.map(toText).join(" ")).join("\n");
    const match = text.match(new RegExp(extractor.pattern, "im"));
    if (!match) return "";
    if (typeof extractor.group === "string") return match.groups?.[extractor.group] ?? "";
    return match[extractor.group ?? 1] ?? "";
  }
  return "";
}

function evaluateTextCommon(text: string, extractors?: Partial<Record<FieldKey, Extractor>>) {
  const common: Partial<Record<FieldKey, string>> = {};
  FIELDS.forEach((field) => {
    const extractor = extractors?.[field];
    if (!extractor) return;
    if (extractor.type === "static") common[field] = extractor.value;
    if (extractor.type === "regex") {
      const match = text.match(new RegExp(extractor.pattern, "im"));
      if (match) common[field] = typeof extractor.group === "string" ? match.groups?.[extractor.group] ?? "" : match[extractor.group ?? 1] ?? "";
    }
  });
  return common;
}

function evaluateRegexFields(text: string, patterns?: Partial<Record<FieldKey, string>>) {
  const fields: Partial<Record<FieldKey, string>> = {};
  FIELDS.forEach((field) => {
    const pattern = patterns?.[field];
    if (!pattern) return;
    const match = text.match(new RegExp(pattern, "im"));
    if (match) fields[field] = match.groups?.value ?? match[1] ?? "";
  });
  return fields;
}

function shouldStop(row: CellValue[], header: CellValue[], stopRule?: StopRule) {
  if (!stopRule) return false;
  if (stopRule.textMatches?.length && matchesAnyCell(row, stopRule.textMatches)) return true;
  if (stopRule.emptyColumn) {
    const column = resolveColumn(stopRule.emptyColumn, header);
    if (column >= 0 && !toText(row[column])) return true;
  }
  return false;
}

function matchesAnyCell(row: CellValue[], textMatches: string[]) {
  if (!textMatches.length) return false;
  const values = row.map(normalizeText);
  return textMatches.some((pattern) => {
    const normalized = normalizeText(pattern);
    return values.some((value) => value.includes(normalized));
  });
}

function isEffectivelyEmpty(row: CellValue[]) {
  return row.every((cell) => !toText(cell));
}

function aggregateIfNeeded(rows: RowObject[], field?: FieldKey) {
  if (!field) return rows;
  const commonByKey = new Map<string, Partial<Record<FieldKey, string>>>();
  rows.forEach((row) => {
    const key = toText(row[field]);
    if (!key) return;
    const existing = commonByKey.get(key) ?? {};
    FIELDS.forEach((candidateField) => {
      if (!existing[candidateField] && toText(row[candidateField])) existing[candidateField] = toText(row[candidateField]);
    });
    commonByKey.set(key, existing);
  });
  return rows.map((row) => ({ ...commonByKey.get(toText(row[field]))!, ...row }));
}

function splitCompositeItems(text: string, customPattern?: string) {
  const lines = text
    .split(/\n|；|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      const match = customPattern
        ? line.match(new RegExp(customPattern, "i"))
        : line.match(/^(?:(?<code>[A-Za-z0-9_-]{3,})\s+)?(?<name>.+?)(?:[xX*×]\s*|[:：]\s*)(?<quantity>\d+(?:\.\d+)?)(?:\s*(?<spec>.+))?$/);
      if (!match) return null;
      return {
        code: match.groups?.code ?? "",
        name: match.groups?.name ?? match[1] ?? "",
        quantity: match.groups?.quantity ?? match[2] ?? "",
        spec: match.groups?.spec ?? ""
      };
    })
    .filter((item): item is { code: string; name: string; quantity: string; spec: string } => Boolean(item?.quantity));
}

function numericText(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "";
}

function pickGroup(match: RegExpMatchArray, name: string, index: number) {
  return toText(match.groups?.[name] ?? match[index]);
}

function normalizeRow(row: RowObject, index: number): OrderRow {
  const orderRow = {
    id: uid("parsed"),
    rowNo: index + 1,
    externalCode: "",
    storeName: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: "",
    skuCode: "",
    skuName: "",
    quantity: "",
    spec: "",
    remark: "",
    ...row
  };
  FIELDS.forEach((field) => {
    orderRow[field] = toText(orderRow[field]);
  });
  return orderRow;
}
