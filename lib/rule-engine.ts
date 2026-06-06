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
type HeaderLocator = { rowIndex?: number; findByKeywords?: string[]; maxScanRows?: number; rowStart?: number; rowEnd?: number };
type RuntimeMatrixStrategy = Omit<Extract<ParseStrategy, { type: "matrix" }>, "headerRow" | "dataStartRow" | "rowFields" | "pivot" | "cell"> & {
  headerRow?: number;
  dataStartRow?: number;
  rowFields?: Partial<Record<FieldKey, ColumnSelector | string>>;
  header?: HeaderLocator;
  columns?: Partial<Record<FieldKey, ColumnSelector | string>>;
  dataStartRowOffset?: number;
  pivot?: Partial<Extract<ParseStrategy, { type: "matrix" }>["pivot"]> & {
    columns?: {
      startAfter?: ColumnSelector | string;
      endBefore?: ColumnSelector | string;
      startAfterCandidates?: string[];
      endBeforeCandidates?: string[];
      excludeCandidates?: string[];
    };
    headerSource?: string;
    headerValue?: boolean;
  };
  cell?: Partial<Extract<ParseStrategy, { type: "matrix" }>["cell"]> & {
    emitWhen?: "positive";
    skipEmpty?: boolean;
    skipZero?: boolean;
    field?: FieldKey;
  };
};
type RuntimeCardStrategy = Omit<Extract<ParseStrategy, { type: "cards" }>, "boundary" | "tableHeader" | "columns"> & {
  boundary?: { pattern?: string; column?: number };
  tableHeader?: { findByKeywords?: string[]; offsetFromBoundary?: number; maxRows?: number };
  columns?: Partial<Record<FieldKey, ColumnSelector | string>>;
};

const DEFAULT_ITEM_HEADER_KEYWORDS = ["物品编码", "商品编码", "SKU编码", "物品名称", "商品名称", "SKU名称", "规格", "数量"];
const DEFAULT_TABLE_HEADER_KEYWORDS = ["编码", "名称", "数量"];
const DEFAULT_ITEM_COLUMNS: Partial<Record<FieldKey, ColumnSelector>> = {
  externalCode: { candidates: ["外部编码", "单据号", "配送单号", "订单号", "调拨单号"] },
  storeName: { candidates: ["收货门店", "调入门店", "门店", "机构"] },
  receiverName: { candidates: ["收件人", "收货人", "联系人"] },
  receiverPhone: { candidates: ["电话", "联系电话", "收货电话", "手机"] },
  receiverAddress: { candidates: ["地址", "收货地址"] },
  skuCode: { candidates: ["物品编码", "SKU编码", "商品编码", "SKU条码", "商品条码", "编码"] },
  skuName: { candidates: ["物品名称", "SKU名称", "商品名称", "品名", "名称"] },
  quantity: { candidates: ["发货数量", "出库数量", "调拨数量", "数量"] },
  spec: { candidates: ["规格型号", "规格", "型号"] },
  remark: { candidates: ["备注"] }
};
const MATRIX_EXCLUDED_HEADER_KEYWORDS = [
  "仓库",
  "货主",
  "sku",
  "商品编码",
  "物品编码",
  "条码",
  "库存",
  "库存状态",
  "库存单位",
  "在库",
  "可用",
  "待移入",
  "分配",
  "冻结",
  "结余",
  "规格",
  "单位",
  "状态",
  "数量",
  "总和",
  "合计",
  "总计"
];
const DETAIL_STOP_KEYWORDS = [
  "合计",
  "总计",
  "小计",
  "单据号",
  "单据编号",
  "上游单据",
  "创建日期",
  "创建人",
  "制单日期",
  "制单人",
  "审核人",
  "发货人",
  "收货人",
  "收货电话",
  "备用联系人",
  "备用联系电话",
  "收货地址",
  "收货机构备注",
  "收货人签字",
  "联系人",
  "联系电话",
  "签字",
  "打印次数",
  "备注"
];
const NON_ITEM_KEYWORDS = [
  ...DETAIL_STOP_KEYWORDS,
  "调入门店",
  "收货门店",
  "调拨记录",
  "物品编码",
  "商品编码",
  "sku编码",
  "sku条码",
  "物品名称",
  "商品名称",
  "sku名称",
  "规格型号",
  "发货数量",
  "出库数量",
  "调拨数量"
];
const TEXT_ITEM_CODE_PATTERN = "[A-Za-z]{1,12}[A-Za-z0-9_-]*\\d[A-Za-z0-9_-]*";
const TEXT_LABEL_BOUNDARIES = [
  "单据编号",
  "单据号",
  "配送单号",
  "订单号",
  "调拨单号",
  "单据状态",
  "复审状态",
  "分拣状态",
  "订单日期",
  "预计发货日期",
  "期望到货日期",
  "发货日期",
  "发货操作时间",
  "收货机构",
  "订货机构",
  "供货机构",
  "送货机构",
  "业务模式",
  "配送重量",
  "制单日期",
  "创建人",
  "发货人",
  "收货人",
  "收货电话",
  "联系电话",
  "电话",
  "收货地址",
  "打印次数",
  "备注"
];

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
  const textStrategies = activeStrategies.filter((strategy): strategy is Extract<ParseStrategy, { type: "textSegments" }> => strategy.type === "textSegments");

  for (const strategy of activeStrategies) {
    if (source.kind === "workbook" && acceptsWorkbook(strategy)) {
      rowObjects = rowObjects.concat(parseWorkbookStrategy(source, rule, strategy, warnings));
    }
    if (source.kind === "text" && strategy.type === "textSegments") {
      rowObjects = rowObjects.concat(parseTextStrategy(source, rule, strategy));
    }
  }

  if (source.kind === "text" && (!textStrategies.length || !rowObjects.some(isLikelyItemRecord))) {
    const fallbackRows = parseAutoTextSource(source, rule);
    if (fallbackRows.length) {
      rowObjects = textStrategies.length ? rowObjects.concat(fallbackRows) : fallbackRows;
      warnings.push(
        textStrategies.length
          ? "文本/PDF规则未解析出有效明细，已启用通用文本兜底解析"
          : "当前文件是文本/PDF，已启用通用文本兜底解析"
      );
    }
  }

  const rows = rowObjects
    .filter(isLikelyItemRecord)
    .map((row, index) => normalizeRow(row, index))
    .filter(isLikelyItemRecord);

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
  const headerIndex = locateHeaderRow(sheet.rows, strategy.header, DEFAULT_TABLE_HEADER_KEYWORDS, 30);

  if (headerIndex < 0) {
    warnings.push(`${sheet.name} 未找到表头，已跳过表格策略`);
    return [];
  }

  const header = sheet.rows[headerIndex] ?? [];
  const dataStart = headerIndex + (strategy.dataStartRowOffset ?? 1);
  const common = collectCommon(sheet, rule, strategy, undefined);
  const rows: RowObject[] = [];
  const columns = normalizeColumns(strategy.columns, DEFAULT_ITEM_COLUMNS);
  let dataStarted = false;

  for (let rowIndex = dataStart; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (isEffectivelyEmpty(row)) continue;
    if (shouldStop(row, header, strategy.stopWhen)) break;
    if (dataStarted && isDetailStopRow(row, header)) break;
    if (matchesAnyCell(row, strategy.skipRowsWhen?.textMatches ?? [])) continue;

    const record = materializeRecord({
      row,
      header,
      sheet,
      rowIndex,
      columns,
      defaults: { ...rule.defaults, ...strategy.defaults },
      common
    });

    if (strategy.skipRowsWhen?.requiredAny?.length) {
      const ok = strategy.skipRowsWhen.requiredAny.some((field) => toText(record[field]));
      if (!ok) continue;
    }

    if (!isLikelyItemRecord(record)) {
      if (dataStarted && isDetailStopRow(row, header)) break;
      continue;
    }

    rows.push(record);
    dataStarted = true;
  }

  return aggregateIfNeeded(rows, strategy.aggregateBy);
}

function parseMatrixSheet(
  sheet: SheetContext,
  rule: ParseRule,
  strategy: Extract<ParseStrategy, { type: "matrix" }>,
  warnings: string[]
) {
  const runtime = strategy as RuntimeMatrixStrategy;
  const headerIndex = locateHeaderRow(
    sheet.rows,
    typeof runtime.headerRow === "number" ? { rowIndex: runtime.headerRow } : runtime.header,
    matrixHeaderKeywords(runtime),
    30
  );
  const header = sheet.rows[headerIndex] ?? [];
  if (!header.length) {
    warnings.push(`${sheet.name} 矩阵表头为空，已跳过矩阵策略`);
    return [];
  }

  const pivot = runtime.pivot ?? {};
  const pivotHeaderRow = sheet.rows[pivot.headerRow ?? headerIndex] ?? [];
  const pivotRange = resolveMatrixPivotRange(pivotHeaderRow, runtime);
  if (!pivotRange) {
    warnings.push(`${sheet.name} 未识别到矩阵门店列，已跳过矩阵策略`);
    return [];
  }

  const rowColumns = normalizeColumns(runtime.rowFields ?? runtime.columns, DEFAULT_ITEM_COLUMNS);
  const common = collectCommon(sheet, rule, strategy, undefined);
  const start = pivotRange.start;
  const end = pivotRange.end;
  const pivotField = pivot.field ?? "storeName";
  const cellMode = runtime.cell?.mode ?? "quantity";
  const rows: RowObject[] = [];
  const dataStart = typeof runtime.dataStartRow === "number" ? runtime.dataStartRow : headerIndex + (runtime.dataStartRowOffset ?? 1);
  let dataStarted = false;

  for (let rowIndex = dataStart; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    if (isEffectivelyEmpty(row)) continue;
    if (shouldStop(row, header, strategy.stopWhen)) break;
    if (dataStarted && isDetailStopRow(row, header)) break;

    const base = materializeRecord({
      row,
      header,
      sheet,
      rowIndex,
      columns: rowColumns,
      defaults: { ...rule.defaults, ...strategy.defaults },
      common
    });

    if (!hasSkuIdentity(base) || isDetailStopRow(row, header)) continue;

    for (let colIndex = start; colIndex <= end; colIndex += 1) {
      if (!isLikelyPivotHeader(pivotHeaderRow[colIndex], runtime.pivot?.columns?.excludeCandidates)) continue;
      const raw = row[colIndex];
      const cellText = toText(raw);
      if (!cellText) continue;
      const pivotLabel = toText(pivotHeaderRow[colIndex]);
      if (!pivotLabel) continue;

      if (cellMode === "quantity") {
        const quantity = numericText(cellText);
        if (!quantity) continue;
        rows.push({
          ...base,
          [pivotField]: `${pivot.valuePrefix ?? ""}${pivotLabel}`,
          quantity,
          sourceSheet: sheet.name,
          sourceRow: rowIndex + 1
        });
        dataStarted = true;
      } else {
        const itemRows = splitCompositeItems(cellText, runtime.cell?.itemPattern);
        itemRows.forEach((item, itemIndex) => {
          const record = {
            ...base,
            [pivotField]: `${pivot.valuePrefix ?? ""}${pivotLabel}`,
            skuName: item.name || base.skuName || "",
            skuCode: item.code || base.skuCode || `${pivotLabel}-${rowIndex + 1}-${itemIndex + 1}`,
            quantity: item.quantity,
            spec: item.spec || base.spec || "",
            sourceSheet: sheet.name,
            sourceRow: rowIndex + 1
          };
          if (isLikelyItemRecord(record)) {
            rows.push(record);
            dataStarted = true;
          }
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
  const runtime = strategy as RuntimeCardStrategy;
  const boundaryRows = findCardBoundaryRows(sheet, runtime);

  if (!boundaryRows.length) {
    warnings.push(`${sheet.name} 未识别到卡片边界，已跳过卡片策略`);
    return [];
  }

  const rows: RowObject[] = [];
  boundaryRows.forEach(({ index: start }, cardIndex) => {
    const end = boundaryRows[cardIndex + 1]?.index ?? sheet.rows.length;
    const cardRows = sheet.rows.slice(start, end);
    const cardSheet: SheetContext = { name: sheet.name, rows: cardRows };
    const tableHeader = runtime.tableHeader ?? {};
    const headerOffset =
      typeof tableHeader.offsetFromBoundary === "number"
        ? tableHeader.offsetFromBoundary
        : findHeaderRow(cardRows, tableHeader.findByKeywords?.length ? tableHeader.findByKeywords : DEFAULT_ITEM_HEADER_KEYWORDS, tableHeader.maxRows ?? 12);

    if (headerOffset < 0) return;
    const header = cardRows[headerOffset] ?? [];
    const autoCommon = inferCardCommon(sheet, cardRows, start, cardIndex);
    const common = {
      ...autoCommon,
      ...evaluateCommonExtractors(rule.common, sheet),
      ...evaluateCommonExtractors(strategy.common, cardSheet),
      ...evaluateCommonExtractors(strategy.cardCommon, cardSheet)
    };
    const columns = normalizeColumns(runtime.columns, DEFAULT_ITEM_COLUMNS);

    for (let localRow = headerOffset + 1; localRow < cardRows.length; localRow += 1) {
      const row = cardRows[localRow] ?? [];
      if (isEffectivelyEmpty(row)) continue;
      if (isDetailStopRow(row, header) || matchesAnyCell(row, ["合计", "总计"])) break;
      const record = materializeRecord({
        row,
        header,
        sheet,
        rowIndex: start + localRow,
        columns,
        defaults: { ...rule.defaults, ...strategy.defaults },
        common
      });
      if (isLikelyItemRecord(record)) rows.push(record);
    }
  });

  return rows;
}

function parseAutoTextSource(source: TextSource, rule: ParseRule) {
  const text = source.text.replace(/\s+/g, " ").trim();
  const common = {
    ...rule.defaults,
    ...evaluateTextCommon(source.text, rule.common),
    externalCode: extractTextLabel(source.text, ["单据编号", "单据号", "配送单号", "订单号", "调拨单号"]) || rule.defaults?.externalCode || "",
    storeName: extractTextLabel(source.text, ["收货机构", "收货门店", "调入门店", "门店"]) || rule.defaults?.storeName || "",
    receiverName: extractTextLabel(source.text, ["收货人", "收件人", "联系人"]) || rule.defaults?.receiverName || "",
    receiverPhone: extractTextLabel(source.text, ["收货电话", "联系电话", "电话", "手机"]) || rule.defaults?.receiverPhone || "",
    receiverAddress: extractTextLabel(source.text, ["收货地址", "地址"]) || rule.defaults?.receiverAddress || ""
  };
  const rows: RowObject[] = [];
  const itemRe = new RegExp(
    `(?:^|\\s)(?<lineNo>\\d{1,4})\\s+(?<category>[^\\s]+)\\s+(?<skuCode>${TEXT_ITEM_CODE_PATTERN})\\s*(?<detail>[\\s\\S]*?)(?=\\s+\\d{1,4}\\s+[^\\s]+\\s+${TEXT_ITEM_CODE_PATTERN}|\\s+合\\s*计|\\s+物品类别|\\s+第\\d+页|$)`,
    "g"
  );

  for (const match of text.matchAll(itemRe)) {
    const detail = toText(match.groups?.detail);
    const quantityMatch = detail.match(/(?:^|\s)(\d+(?:,\d{3})*(?:\.\d+)?)\s*$/);
    if (!quantityMatch) continue;
    const detailWithoutQuantity = toText(detail.slice(0, quantityMatch.index));
    const itemText = stripTrailingUnit(detailWithoutQuantity);
    const item = splitNameAndSpec(itemText);
    const record: RowObject = {
      ...common,
      skuCode: toText(match.groups?.skuCode),
      skuName: item.name,
      spec: item.spec,
      quantity: normalizeQuantity(quantityMatch[1]),
      sourceSheet: "文本/PDF",
      sourceRow: Number(match.groups?.lineNo) || rows.length + 1
    };
    if (isLikelyItemRecord(record)) rows.push(record);
  }

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

function locateHeaderRow(rows: CellValue[][], locator: HeaderLocator | undefined, fallbackKeywords: string[], fallbackMaxRows: number) {
  if (typeof locator?.rowIndex === "number") return locator.rowIndex;

  const keywords = locator?.findByKeywords?.length ? locator.findByKeywords : fallbackKeywords;
  const start = Math.max(locator?.rowStart ?? 0, 0);
  const end =
    typeof locator?.rowEnd === "number"
      ? Math.min(locator.rowEnd + 1, rows.length)
      : Math.min(start + (locator?.maxScanRows ?? fallbackMaxRows), rows.length);

  const sliced = rows.slice(start, end);
  const found = findHeaderRow(sliced, keywords, sliced.length);
  return found >= 0 ? start + found : -1;
}

function matrixHeaderKeywords(strategy: RuntimeMatrixStrategy) {
  const explicit = strategy.header?.findByKeywords ?? [];
  const columnKeywords = selectorKeywords(strategy.rowFields ?? strategy.columns);
  return uniqueText([...explicit, ...columnKeywords, ...DEFAULT_ITEM_HEADER_KEYWORDS]);
}

function resolveMatrixPivotRange(header: CellValue[], strategy: RuntimeMatrixStrategy) {
  const pivot = strategy.pivot ?? {};
  const columns = pivot.columns;
  const startAfter = resolveColumnFromOptions(header, columns?.startAfter, columns?.startAfterCandidates);
  const endBefore = resolveColumnFromOptions(header, columns?.endBefore, columns?.endBeforeCandidates);
  const likelyColumns = header
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => isLikelyPivotHeader(cell, columns?.excludeCandidates))
    .map(({ index }) => index);

  let start =
    typeof pivot.startColumn === "number"
      ? pivot.startColumn
      : startAfter >= 0
        ? startAfter + 1
        : likelyColumns[0];
  let end =
    typeof pivot.endColumn === "number"
      ? pivot.endColumn
      : endBefore >= 0
        ? endBefore - 1
        : likelyColumns[likelyColumns.length - 1];

  if (typeof start !== "number" || typeof end !== "number") return null;
  start = Math.max(start, 0);
  end = Math.min(end, header.length - 1);
  while (start <= end && !isLikelyPivotHeader(header[start], columns?.excludeCandidates)) start += 1;
  while (end >= start && !isLikelyPivotHeader(header[end], columns?.excludeCandidates)) end -= 1;
  return start <= end ? { start, end } : null;
}

function resolveColumnFromOptions(header: CellValue[], selector?: ColumnSelector | string, candidates?: string[]) {
  const normalized = normalizeColumnSelector(selector);
  const candidateSelector = candidates?.length ? { candidates } : undefined;
  const column = normalized ? resolveColumn(normalized, header) : -1;
  return column >= 0 || !candidateSelector ? column : resolveColumn(candidateSelector, header);
}

function isLikelyPivotHeader(value: unknown, extraExcludes: string[] = []) {
  const text = toText(value);
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const excludes = uniqueText([...MATRIX_EXCLUDED_HEADER_KEYWORDS, ...extraExcludes]).map(normalizeText);
  if (excludes.some((keyword) => normalized === keyword || normalized.includes(keyword))) return false;
  return true;
}

function findCardBoundaryRows(sheet: SheetContext, strategy: RuntimeCardStrategy) {
  const pattern = strategy.boundary?.pattern;
  if (pattern) {
    try {
      const boundaryRe = new RegExp(pattern);
      const matches = sheet.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => boundaryRe.test(toText(row[strategy.boundary?.column ?? 0]) || row.map(toText).join(" ")));
      if (matches.length) return matches;
    } catch {
      // Ignore invalid AI-generated boundary patterns and use structural detection below.
    }
  }

  const candidates = sheet.rows.map((row, index) => ({ row, index }));
  const markerMatches = candidates.filter(({ row }) => {
    const text = normalizeText(row.map(toText).join(" "));
    return /(?:调拨|配送|发货|订单|出库)?记录[#＃]?\d+/.test(text) || /^▶/.test(toText(row[0]));
  });
  if (markerMatches.length) return markerMatches;

  return candidates.filter(({ row }) => {
    const first = normalizeText(row[0]);
    return first.includes("调入门店") || first.includes("收货门店");
  });
}

function inferCardCommon(sheet: SheetContext, cardRows: CellValue[][], absoluteStart: number, cardIndex: number): Partial<Record<FieldKey, string>> {
  const globalRows = sheet.rows.slice(0, Math.min(Math.max(absoluteStart, 1), 12));
  const cardCode = extractLabeledValue(cardRows, ["外部编码", "配送单号", "订单号", "调拨单号", "单号"]);
  const globalCode = extractLabeledValue(globalRows, ["外部编码", "配送单号", "订单号", "调拨单号", "单号"]);
  const marker = extractCardMarker(cardRows) || String(cardIndex + 1);
  const externalCode = cardCode || (globalCode ? `${globalCode}-${marker}` : "");

  return {
    externalCode,
    storeName: extractLabeledValue(cardRows, ["调入门店", "收货门店", "收货机构", "门店", "机构"]),
    receiverName: extractLabeledValue(cardRows, ["收货人", "收件人", "联系人"]),
    receiverPhone: extractLabeledValue(cardRows, ["联系电话", "收货电话", "电话", "手机"]),
    receiverAddress: extractLabeledValue(cardRows, ["收货地址", "地址"])
  };
}

function extractCardMarker(rows: CellValue[][]) {
  const text = rows
    .slice(0, 3)
    .map((row) => row.map(toText).join(" "))
    .join(" ");
  const match = text.match(/[#＃]\s*([A-Za-z0-9_-]+)/) ?? text.match(/第\s*([A-Za-z0-9_-]+)\s*(?:张|条|个|单|组|块)/);
  return match?.[1] ?? "";
}

function extractLabeledValue(rows: CellValue[][], labels: string[]) {
  const normalizedLabels = labels.map(normalizeText);
  for (const row of rows) {
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cellText = toText(row[colIndex]);
      if (!cellText) continue;
      const normalizedCell = normalizeText(cellText);
      for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
        const label = labels[labelIndex];
        const normalizedLabel = normalizedLabels[labelIndex];
        if (normalizedCell === normalizedLabel || normalizedCell.includes(`${normalizedLabel}:`)) {
          const inline = extractInlineLabelValue(cellText, label);
          if (inline) return inline;
          const right = toText(row[colIndex + 1]);
          if (right) return right;
        }
      }
    }
    const rowText = row.map(toText).join(" | ");
    for (const label of labels) {
      const inline = extractInlineLabelValue(rowText, label);
      if (inline) return inline;
    }
  }
  return "";
}

function extractInlineLabelValue(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*[:：]\\s*([^|\\n\\r]+)`, "i"));
  return match ? toText(match[1]) : "";
}

function evaluateCommonExtractors(extractors: Partial<Record<FieldKey, Extractor>> | undefined, sheet: SheetContext) {
  const common: Partial<Record<FieldKey, string>> = {};
  FIELDS.forEach((field) => {
    const extractor = extractors?.[field];
    if (extractor) common[field] = evaluateExtractor(extractor, sheet);
  });
  return common;
}

function normalizeColumns(
  columns: Partial<Record<FieldKey, ColumnSelector | string>> | undefined,
  defaults: Partial<Record<FieldKey, ColumnSelector>> = {}
) {
  const normalized: Partial<Record<FieldKey, ColumnSelector>> = {};
  FIELDS.forEach((field) => {
    const fallback = defaults[field];
    const selector = normalizeColumnSelector(columns?.[field]);
    if (fallback || selector) normalized[field] = mergeColumnSelectors(fallback, selector);
  });
  return normalized;
}

function normalizeColumnSelector(value: unknown): ColumnSelector | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return { candidates: [value] };
  if (Array.isArray(value)) return { candidates: value.map(toText).filter(Boolean) };
  if (typeof value !== "object") return undefined;

  const input = value as { index?: unknown; header?: unknown; candidates?: unknown };
  const selector: ColumnSelector = {};
  if (typeof input.index === "number") selector.index = input.index;
  if (typeof input.header === "string") selector.header = input.header;
  if (Array.isArray(input.candidates)) selector.candidates = input.candidates.map(toText).filter(Boolean);
  return selector.index !== undefined || selector.header || selector.candidates?.length ? selector : undefined;
}

function mergeColumnSelectors(fallback?: ColumnSelector, selector?: ColumnSelector): ColumnSelector {
  if (!fallback) return selector ?? {};
  if (!selector) return fallback;
  return {
    index: selector.index ?? fallback.index,
    header: selector.header ?? fallback.header,
    candidates: uniqueText([selector.header, ...(selector.candidates ?? []), fallback.header, ...(fallback.candidates ?? [])])
  };
}

function selectorKeywords(columns?: Partial<Record<FieldKey, ColumnSelector | string>>) {
  return FIELDS.flatMap((field) => {
    const selector = normalizeColumnSelector(columns?.[field]);
    return [selector?.header, ...(selector?.candidates ?? [])].filter((value): value is string => Boolean(value));
  });
}

function uniqueText(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => toText(value)).filter(Boolean)));
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

function isDetailStopRow(row: CellValue[], header?: CellValue[]) {
  const values = row.map(toText).filter(Boolean);
  if (!values.length) return false;
  const normalizedValues = values.map(normalizeText);
  const first = normalizedValues[0] ?? "";
  const rowText = normalizedValues.join("|");
  const nonEmptyCount = values.length;

  if (/^▶/.test(values[0] ?? "")) return true;
  if (/^(合计|总计|小计)/.test(first)) return true;
  if (rowText.includes("合计:") || rowText.includes("合计：")) return true;
  if (looksLikeRepeatedHeader(row, header)) return true;
  if (normalizedValues.some((value) => /^第\d+页/.test(value) || /第\d+页\/共\d+页/.test(value))) return true;

  const hitCount = DETAIL_STOP_KEYWORDS.reduce((sum, keyword) => {
    const normalized = normalizeText(keyword);
    return normalizedValues.some((value) => value === normalized || value.includes(normalized)) ? sum + 1 : sum;
  }, 0);

  return hitCount >= 2 || (nonEmptyCount <= 3 && hitCount >= 1);
}

function looksLikeRepeatedHeader(row: CellValue[], header?: CellValue[]) {
  const values = row.map(normalizeText).filter(Boolean);
  if (!values.length) return false;
  const headerValues = (header ?? []).map(normalizeText).filter(Boolean);
  const itemHeaderHits = DEFAULT_ITEM_HEADER_KEYWORDS.filter((keyword) => {
    const normalized = normalizeText(keyword);
    return values.some((value) => value === normalized || value.includes(normalized));
  }).length;

  if (itemHeaderHits >= 2) return true;
  if (!headerValues.length) return false;

  const overlap = values.filter((value) => headerValues.includes(value)).length;
  return overlap >= Math.min(3, values.length) && values.length <= headerValues.length + 2;
}

function isLikelyItemRecord(record: Partial<Record<FieldKey, string>>) {
  const quantity = normalizeQuantity(record.quantity);
  if (!quantity) return false;
  if (!hasSkuIdentity(record)) return false;

  const skuCode = normalizeText(record.skuCode);
  const skuName = normalizeText(record.skuName);
  const spec = normalizeText(record.spec);
  const identity = [skuCode, skuName].filter(Boolean);
  if (!identity.length) return false;

  const hasNonItemIdentity = identity.some((value) =>
    NON_ITEM_KEYWORDS.some((keyword) => {
      const normalized = normalizeText(keyword);
      return value === normalized || value.includes(normalized);
    })
  );
  if (hasNonItemIdentity) return false;
  if (skuCode && !looksLikeSkuCode(skuCode) && !skuName) return false;
  if (!skuCode && skuName && looksLikeControlText(skuName)) return false;
  if (spec && looksLikeControlText(spec) && !skuName) return false;

  return true;
}

function hasSkuIdentity(record: Partial<Record<FieldKey, string>>) {
  return Boolean(toText(record.skuCode) || toText(record.skuName));
}

function looksLikeSkuCode(value: string) {
  if (!value) return false;
  if (value.length > 64) return false;
  if (NON_ITEM_KEYWORDS.some((keyword) => value === normalizeText(keyword))) return false;
  return /[a-z0-9]/i.test(value) || /^[\u4e00-\u9fa5]{2,}[a-z0-9_-]*$/i.test(value);
}

function looksLikeControlText(value: string) {
  if (!value) return false;
  return NON_ITEM_KEYWORDS.some((keyword) => {
    const normalized = normalizeText(keyword);
    return value === normalized || value.includes(normalized);
  });
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

function extractTextLabel(text: string, labels: string[]) {
  const boundaries = uniqueText([...TEXT_LABEL_BOUNDARIES, ...labels]).map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n\\r]+?)(?=\\s*(?:${boundaries.join("|")})\\s*[:：]|\\n|$)`, "i"));
    if (match) return cleanupTextValue(match[1]);
  }
  return "";
}

function cleanupTextValue(value: string) {
  return toText(value)
    .replace(/\s*(?:物品类别|物品编码|物品名称|规格型号|订货单位|发货数量|备注).*$/i, "")
    .replace(/\s*第\d+页\s*\/\s*共\d+页.*$/i, "")
    .trim();
}

function stripTrailingUnit(value: string) {
  const text = toText(value);
  return text.replace(/\s+(?:件|包|瓶|桶|盒|箱|袋|顶|条|套|个|斤|公斤|kg|KG|码|均码|L码|XL码|2XL码|3XL码|4XL码)$/i, "").trim();
}

function splitNameAndSpec(value: string) {
  const text = toText(value);
  if (!text) return { name: "", spec: "" };

  const specStart = text.search(
    /(?:\d+(?:\.\d+)?\s*(?:ml|l|g|kg|KG|斤|公斤|瓶|包|袋|盒|桶|箱|件|片|码)|均码|[234]?XL码|L码|M码|S码|\d+(?:\.\d+)?\s*[*×xX]\s*\d+)/i
  );
  if (specStart > 0) {
    return {
      name: toText(text.slice(0, specStart)),
      spec: toText(text.slice(specStart))
    };
  }

  const tailSpec = text.match(/^(?<name>.+?)\s+(?<spec>(?:均码|[234]?XL码|L码|M码|S码))$/i);
  if (tailSpec?.groups) return { name: toText(tailSpec.groups.name), spec: toText(tailSpec.groups.spec) };

  return { name: text, spec: "" };
}

function numericText(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "";
}

function normalizeQuantity(value: unknown) {
  const text = toText(value).replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return "";
  const numeric = Number(text);
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
