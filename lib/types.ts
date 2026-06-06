export type FieldKey =
  | "externalCode"
  | "storeName"
  | "receiverName"
  | "receiverPhone"
  | "receiverAddress"
  | "skuCode"
  | "skuName"
  | "quantity"
  | "spec"
  | "remark";

export const FIELD_LABELS: Record<FieldKey, string> = {
  externalCode: "外部编码",
  storeName: "收货门店",
  receiverName: "收件人姓名",
  receiverPhone: "收件人电话",
  receiverAddress: "收件人地址",
  skuCode: "SKU物品编码",
  skuName: "SKU物品名称",
  quantity: "SKU发货数量",
  spec: "SKU规格型号",
  remark: "备注"
};

export type OrderRow = Record<FieldKey, string> & {
  id: string;
  rowNo: number;
  sourceSheet?: string;
  sourceRow?: number;
  duplicateHint?: string;
};

export type WorkbookSource = {
  kind: "workbook";
  fileName: string;
  sheets: Array<{
    name: string;
    rows: CellValue[][];
  }>;
};

export type TextSource = {
  kind: "text";
  fileName: string;
  text: string;
  pages?: string[];
};

export type ParsedSource = WorkbookSource | TextSource;

export type CellValue = string | number | boolean | null;

export type ColumnSelector = {
  index?: number;
  header?: string;
  candidates?: string[];
};

export type Extractor =
  | { type: "static"; value: string }
  | { type: "sheetName" }
  | { type: "cell"; row: number; column: number }
  | {
      type: "labelRight";
      label: string;
      rowStart?: number;
      rowEnd?: number;
      valueOffset?: number;
      occurrence?: number;
    }
  | { type: "regex"; pattern: string; group?: number | string };

export type StopRule = {
  column?: ColumnSelector;
  textMatches?: string[];
  emptyColumn?: ColumnSelector;
};

export type HeaderLocator = { rowIndex?: number; findByKeywords?: string[]; maxScanRows?: number; rowStart?: number; rowEnd?: number };

export type BaseStrategy = {
  id?: string;
  enabled?: boolean;
  sheets?: "first" | "all" | string[];
  common?: Partial<Record<FieldKey, Extractor>>;
  defaults?: Partial<Record<FieldKey, string>>;
};

export type TableStrategy = BaseStrategy & {
  type: "table";
  header: HeaderLocator;
  dataStartRowOffset?: number;
  columns: Partial<Record<FieldKey, ColumnSelector>>;
  stopWhen?: StopRule;
  skipRowsWhen?: { textMatches?: string[]; requiredAny?: FieldKey[] };
  aggregateBy?: FieldKey;
};

export type MatrixStrategy = BaseStrategy & {
  type: "matrix";
  headerRow?: number;
  dataStartRow?: number;
  header?: HeaderLocator;
  dataStartRowOffset?: number;
  rowFields?: Partial<Record<FieldKey, ColumnSelector>>;
  columns?: Partial<Record<FieldKey, ColumnSelector>>;
  pivot: {
    headerRow?: number;
    startColumn?: number;
    endColumn?: number;
    field: FieldKey;
    valuePrefix?: string;
    columns?: {
      startAfter?: ColumnSelector;
      endBefore?: ColumnSelector;
      startAfterCandidates?: string[];
      endBeforeCandidates?: string[];
      excludeCandidates?: string[];
    };
    headerSource?: string;
    headerValue?: boolean;
  };
  cell: {
    mode?: "quantity" | "items";
    quantityField?: FieldKey;
    itemPattern?: string;
    emitWhen?: "positive";
    skipEmpty?: boolean;
    skipZero?: boolean;
    field?: FieldKey;
  };
  stopWhen?: StopRule;
};

export type CardStrategy = BaseStrategy & {
  type: "cards";
  boundary?: { pattern?: string; column?: number };
  tableHeader?: { findByKeywords?: string[]; offsetFromBoundary?: number; maxRows?: number };
  columns?: Partial<Record<FieldKey, ColumnSelector>>;
  cardCommon?: Partial<Record<FieldKey, Extractor>>;
};

export type TextStrategy = BaseStrategy & {
  type: "textSegments";
  segmentBoundary?: string;
  commonPatterns?: Partial<Record<FieldKey, string>>;
  itemLinePattern: string;
};

export type ParseStrategy = TableStrategy | MatrixStrategy | CardStrategy | TextStrategy;

export type ParseRule = {
  id?: string;
  name: string;
  description?: string;
  version: 2;
  source: "workbook" | "text" | "any";
  sheetMode?: "first" | "all";
  common?: Partial<Record<FieldKey, Extractor>>;
  defaults?: Partial<Record<FieldKey, string>>;
  strategies: ParseStrategy[];
  assumptions?: Array<{ field: string; reason: string; confidence: number }>;
};

export type ValidationIssue = {
  rowId: string;
  rowNo: number;
  field: FieldKey;
  message: string;
  severity: "error" | "warning";
};

export type RuleRecord = {
  id: number;
  name: string;
  description: string | null;
  rule: ParseRule;
  created_at: string;
  updated_at: string;
};
