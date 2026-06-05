import { FIELD_LABELS, FieldKey, OrderRow, ValidationIssue } from "@/lib/types";
import { toText } from "@/lib/utils";

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

export function validateRows(rows: OrderRow[], existingDuplicateCodes = new Set<string>()) {
  const issues: ValidationIssue[] = [];
  const seenLine = new Map<string, number>();

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
    if (externalCode && existingDuplicateCodes.has(externalCode)) {
      issues.push({
        rowId: row.id,
        rowNo,
        field: "externalCode",
        message: "外部编码已存在于历史运单",
        severity: "error"
      });
    }

    const lineKey = `${externalCode || `row-${rowNo}`}::${toText(row.skuCode)}::${toText(row.skuName)}`;
    if (toText(row.skuCode) || toText(row.skuName)) {
      const first = seenLine.get(lineKey);
      if (first) {
        issues.push({
          rowId: row.id,
          rowNo,
          field: "externalCode",
          message: `与第 ${first} 行可能重复`,
          severity: "warning"
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
