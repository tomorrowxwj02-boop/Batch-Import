import { FIELD_LABELS, FieldKey, OrderRow, ValidationIssue } from "@/lib/types";
import { toText } from "@/lib/utils";

export type DuplicateLookupRow = { externalCode?: string | null; skuCode?: string | null };
export type DuplicateValidationContext = {
  existingExternalCodes?: Set<string>;
  existingLineKeys?: Set<string>;
};

export const EDITABLE_FIELDS: FieldKey[] = [
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

const PHONE_RE = /^(\+?86[-\s]?)?1[3-9]\d{9}$|^0\d{2,3}[-\s]?\d{7,8}$/;

export function makeExternalCodeKey(value: unknown) {
  return toText(value).toLowerCase();
}

export function makeSkuCodeKey(value: unknown) {
  return toText(value).toLowerCase();
}

export function makeOrderLineKey(row: DuplicateLookupRow) {
  const externalCode = makeExternalCodeKey(row.externalCode);
  const skuCode = makeSkuCodeKey(row.skuCode);
  return externalCode && skuCode ? `${externalCode}::${skuCode}` : "";
}

export function emptyRow(rowNo: number): OrderRow {
  return {
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    rowNo,
    externalCode: "",
    storeName: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: "",
    skuCode: "",
    skuName: "",
    quantity: "",
    spec: "",
    remark: ""
  };
}

export function validateRows(rows: OrderRow[], duplicateContext: DuplicateValidationContext = {}) {
  const issues: ValidationIssue[] = [];
  const seenLine = new Map<string, number>();
  const existingExternalCodes = duplicateContext.existingExternalCodes ?? new Set<string>();
  const existingLineKeys = duplicateContext.existingLineKeys ?? new Set<string>();

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const hasStoreGroup = Boolean(toText(row.storeName));
    const hasReceiverGroup =
      Boolean(toText(row.receiverName)) && Boolean(toText(row.receiverPhone)) && Boolean(toText(row.receiverAddress));

    if (!hasStoreGroup && !hasReceiverGroup) {
      issues.push({
        rowId: row.id,
        rowNo,
        field: "storeName",
        message: "收货门店或收件人姓名/电话/地址至少填写一组",
        severity: "error"
      });
    }

    (["skuCode", "skuName", "quantity"] as FieldKey[]).forEach((field) => {
      if (!toText(row[field])) {
        issues.push({ rowId: row.id, rowNo, field, message: `${FIELD_LABELS[field]}不能为空`, severity: "error" });
      }
    });

    const quantity = Number(String(row.quantity).replace(/,/g, ""));
    if (toText(row.quantity) && (!Number.isFinite(quantity) || quantity <= 0)) {
      issues.push({ rowId: row.id, rowNo, field: "quantity", message: "发货数量必须为正数", severity: "error" });
    }

    if (toText(row.receiverPhone) && !PHONE_RE.test(toText(row.receiverPhone))) {
      issues.push({ rowId: row.id, rowNo, field: "receiverPhone", message: "电话格式不正确", severity: "error" });
    }

    const externalCode = toText(row.externalCode);
    const lineKey = makeOrderLineKey(row);
    if (lineKey && existingLineKeys.has(lineKey)) {
      issues.push({
        rowId: row.id,
        rowNo,
        field: "skuCode",
        message: "该外部编码下的 SKU 已存在，请勿重复提交",
        severity: "error"
      });
    }

    const externalCodeKey = makeExternalCodeKey(externalCode);
    if (externalCodeKey && existingExternalCodes.has(externalCodeKey) && (!lineKey || !existingLineKeys.has(lineKey))) {
      issues.push({
        rowId: row.id,
        rowNo,
        field: "externalCode",
        message: "外部编码已存在，本行会作为该运单的新 SKU 明细追加",
        severity: "warning"
      });
    }

    if (lineKey) {
      const first = seenLine.get(lineKey);
      if (first) {
        issues.push({
          rowId: row.id,
          rowNo,
          field: "skuCode",
          message: `与第 ${first} 行外部编码和 SKU 重复`,
          severity: "error"
        });
      } else {
        seenLine.set(lineKey, rowNo);
      }
    }
  });

  return issues;
}

export function issueMap(issues: ValidationIssue[]) {
  const map = new Map<string, ValidationIssue[]>();
  issues.forEach((issue) => {
    const key = `${issue.rowId}:${issue.field}`;
    map.set(key, [...(map.get(key) ?? []), issue]);
  });
  return map;
}
