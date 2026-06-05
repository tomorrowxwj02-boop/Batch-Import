"use client";

import {
  AlertCircle,
  Bell,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Folder,
  History,
  Home,
  Loader2,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  UploadCloud
} from "lucide-react";
import { ChangeEvent, DragEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { BLANK_RULE } from "@/lib/default-rule";
import { parseFileToSource, sampleSource, sourceStats } from "@/lib/client-file";
import { parseWithRule } from "@/lib/rule-engine";
import { FIELD_LABELS, FieldKey, OrderRow, ParsedSource, ParseRule, RuleRecord, ValidationIssue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EDITABLE_FIELDS, emptyRow, issueMap, validateRows } from "@/lib/validation";

type Toast = { type: "success" | "error" | "info"; text: string };

type HistoryItem = {
  id: number;
  skuCode: string;
  skuName: string;
  quantity: string;
  spec: string | null;
  remark: string | null;
  created_at: string;
};

type HistoryOrder = {
  order_key: string;
  external_code: string | null;
  store_name: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  receiver_address: string | null;
  sku_count: number;
  total_quantity: string;
  source_file: string | null;
  batch_id: string;
  created_at: string;
};

type HistoryHeaderDraft = {
  externalCode: string;
  storeName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
};

type HistoryItemDraft = {
  skuCode: string;
  skuName: string;
  quantity: string;
  spec: string;
  remark: string;
};

type HistoryDetailState = {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  header: HistoryHeaderDraft;
  newItem: HistoryItemDraft;
};

const ROW_HEIGHT = 42;
const PREVIEW_HEIGHT = 484;

export function ImporterApp() {
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [ruleDraft, setRuleDraft] = useState<ParseRule>(BLANK_RULE);
  const [ruleText, setRuleText] = useState(JSON.stringify(BLANK_RULE, null, 2));
  const [source, setSource] = useState<ParsedSource | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [progress, setProgress] = useState({ percent: 0, label: "等待上传" });
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [metrics, setMetrics] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [history, setHistory] = useState<{ rows: HistoryOrder[]; total: number; page: number; pageSize: number }>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 12
  });
  const [historyQuery, setHistoryQuery] = useState("");
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [historyDetails, setHistoryDetails] = useState<Record<string, HistoryDetailState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRules();
    void loadHistory();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    setIssues(validateRows(rows, existingCodes));
  }, [rows, existingCodes]);

  const stats = source ? sourceStats(source) : null;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const mappedIssues = useMemo(() => issueMap(issues), [issues]);

  async function loadRules() {
    try {
      const res = await fetch("/api/rules", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "规则加载失败");
      setRules(data.rules ?? []);
      if (data.rules?.[0]) {
        setSelectedRuleId(String(data.rules[0].id));
        setRuleDraft(data.rules[0].rule);
        setRuleText(JSON.stringify(data.rules[0].rule, null, 2));
      }
    } catch (error) {
      showToast("error", getMessage(error));
    }
  }

  async function loadHistory(page = history.page, q = historyQuery) {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(history.pageSize) });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "历史列表加载失败");
      const nextRows = (data.rows ?? []) as HistoryOrder[];
      const visibleKeys = new Set(nextRows.map((row) => row.order_key));
      setHistory({ rows: nextRows, total: Number(data.total ?? 0), page: Number(data.page ?? page), pageSize: Number(data.pageSize ?? history.pageSize) });
      setExpandedHistory((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
      setHistoryDetails((current) => {
        const filtered = Object.entries(current).filter(([key]) => visibleKeys.has(key));
        return Object.fromEntries(filtered) as Record<string, HistoryDetailState>;
      });
    } catch (error) {
      showToast("error", getMessage(error));
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const file = files[0];
    if (!file) return;
    setBusy("file");
    setRows([]);
    setIssues([]);
    setAiNotes([]);
    setFileName(file.name);
    try {
      const parsed = await parseFileToSource(file, (percent, label) => setProgress({ percent, label }));
      setSource(parsed);
      setProgress({ percent: 100, label: "文件已就绪，选择规则或生成新规则" });
      showToast("success", "文件解析为统一样本完成");
    } catch (error) {
      setSource(null);
      setProgress({ percent: 0, label: "解析失败" });
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void handleFiles(event.dataTransfer.files);
  }

  function onRuleSelect(id: string) {
    setSelectedRuleId(id);
    const selected = rules.find((rule) => String(rule.id) === id);
    if (selected) {
      setRuleDraft(selected.rule);
      setRuleText(JSON.stringify(selected.rule, null, 2));
    }
  }

  function parseRuleText() {
    try {
      const parsed = JSON.parse(ruleText) as ParseRule;
      if (!parsed.name || !Array.isArray(parsed.strategies)) throw new Error("规则至少需要 name 和 strategies");
      setRuleDraft(parsed);
      return parsed;
    } catch (error) {
      showToast("error", `规则 JSON 不合法：${getMessage(error)}`);
      return null;
    }
  }

  async function generateRule() {
    if (!source) {
      showToast("error", "请先上传一个样例文件");
      return;
    }
    setBusy("ai");
    try {
      const res = await fetch("/api/ai/rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: sampleSource(source) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 生成规则失败");
      setRuleDraft(data.rule);
      setRuleText(JSON.stringify(data.rule, null, 2));
      setAiNotes(data.notes ?? []);
      setSelectedRuleId("");
      showToast("success", "AI 已生成规则草案，请预览后保存");
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  function previewParse() {
    if (!source) {
      showToast("error", "请先上传文件");
      return;
    }
    const rule = parseRuleText();
    if (!rule) return;
    setBusy("parse");
    window.setTimeout(async () => {
      try {
        const result = parseWithRule(source, rule);
        setRows(result.rows);
        setMetrics(`解析 ${result.rows.length} 行，用时 ${result.metrics.durationMs}ms，策略 ${result.metrics.strategies} 个`);
        await checkDuplicates(result.rows);
        setProgress({ percent: 100, label: `试解析完成：${result.rows.length} 行` });
        if (result.rows.length) showToast("success", "试解析完成，可继续编辑或提交");
        else showToast("error", "规则未解析出数据，请调整映射后重试");
      } catch (error) {
        showToast("error", getMessage(error));
      } finally {
        setBusy("");
      }
    }, 20);
  }

  async function checkDuplicates(nextRows: OrderRow[]) {
    const codes = nextRows.map((row) => row.externalCode).filter(Boolean);
    if (!codes.length) {
      setExistingCodes(new Set());
      return;
    }
    try {
      const res = await fetch("/api/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重复检测失败");
      setExistingCodes(new Set(data.codes ?? []));
    } catch (error) {
      showToast("error", getMessage(error));
    }
  }

  async function saveRule() {
    const rule = parseRuleText();
    if (!rule) return;
    setBusy("save-rule");
    try {
      const isUpdate = Boolean(selectedRuleId);
      const res = await fetch(isUpdate ? `/api/rules/${selectedRuleId}` : "/api/rules", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule, description: rule.description })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "规则保存失败");
      await loadRules();
      setSelectedRuleId(String(data.rule.id));
      showToast("success", "规则已保存到数据库");
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function deleteSelectedRule() {
    if (!selectedRuleId) return;
    setBusy("delete-rule");
    try {
      const res = await fetch(`/api/rules/${selectedRuleId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "规则删除失败");
      setSelectedRuleId("");
      setRuleDraft(BLANK_RULE);
      setRuleText(JSON.stringify(BLANK_RULE, null, 2));
      await loadRules();
      showToast("success", "规则已删除");
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  function duplicateRule() {
    const rule = parseRuleText();
    if (!rule) return;
    const copied = { ...rule, name: `${rule.name} 副本` };
    setSelectedRuleId("");
    setRuleDraft(copied);
    setRuleText(JSON.stringify(copied, null, 2));
    showToast("info", "已复制为新规则草案");
  }

  function newRule() {
    const rule = { ...BLANK_RULE, name: fileName ? `${fileName} 解析规则` : "新解析规则" };
    setSelectedRuleId("");
    setRuleDraft(rule);
    setRuleText(JSON.stringify(rule, null, 2));
    setAiNotes([]);
  }

  function updateCell(rowId: string, field: FieldKey, value: string) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setRows((current) => [...current, emptyRow(current.length + 1)]);
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, rowNo: index + 1 })));
  }

  async function submitOrders() {
    const currentIssues = validateRows(rows, existingCodes).filter((issue) => issue.severity === "error");
    setIssues(validateRows(rows, existingCodes));
    if (!rows.length) {
      showToast("error", "没有可提交的数据");
      return;
    }
    if (currentIssues.length) {
      showToast("error", `还有 ${currentIssues.length} 个错误，请先修正`);
      return;
    }
    setBusy("submit");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, sourceFile: fileName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      showToast("success", `提交完成：成功 ${data.success} 条 SKU，生成 ${data.orderCount ?? "-"} 张运单，失败 ${data.failed?.length ?? 0} 条`);
      await loadHistory(1);
      await checkDuplicates(rows);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function exportExcel() {
    if (!rows.length) {
      showToast("error", "没有可导出的数据");
      return;
    }
    const XLSX = await import("xlsx");
    const data = rows.map((row, index) => {
      const item: Record<string, string | number> = { 行号: index + 1 };
      EDITABLE_FIELDS.forEach((field) => {
        item[FIELD_LABELS[field]] = row[field];
      });
      return item;
    });
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "预览数据");
    XLSX.writeFile(book, `万能导入预览-${Date.now()}.xlsx`);
    showToast("success", "Excel 已导出");
  }

  function toggleHistory(order: HistoryOrder) {
    const orderKey = order.order_key;
    const shouldOpen = !expandedHistory.has(orderKey);
    setExpandedHistory((current) => {
      const next = new Set(current);
      if (next.has(orderKey)) next.delete(orderKey);
      else next.add(orderKey);
      return next;
    });
    if (shouldOpen) void loadHistoryItems(order, historyDetails[orderKey]?.page ?? 1, historyDetails[orderKey]?.q ?? "");
  }

  async function loadHistoryItems(orderOrKey: HistoryOrder | string, page = 1, q = "") {
    const orderKey = typeof orderOrKey === "string" ? orderOrKey : orderOrKey.order_key;
    const order = typeof orderOrKey === "string" ? history.rows.find((row) => row.order_key === orderKey) : orderOrKey;
    const existing = historyDetails[orderKey];
    const params = new URLSearchParams({ page: String(page), pageSize: String(existing?.pageSize ?? 8) });
    if (q.trim()) params.set("q", q.trim());
    setBusy(`history-items:${orderKey}`);
    try {
      const res = await fetch(`/api/orders/${orderKeyPath(orderKey)}/items?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SKU 明细加载失败");
      setHistoryDetails((current) => {
        const currentDetail = current[orderKey];
        return {
          ...current,
          [orderKey]: {
            items: (data.items ?? []).map(normalizeHistoryItem),
            total: Number(data.total ?? 0),
            page: Number(data.page ?? page),
            pageSize: Number(data.pageSize ?? currentDetail?.pageSize ?? 8),
            q,
            header: currentDetail?.header ?? (order ? historyHeaderFromOrder(order) : emptyHistoryHeader()),
            newItem: currentDetail?.newItem ?? emptyHistoryItemDraft()
          }
        };
      });
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  function updateHistoryHeaderField(orderKey: string, field: keyof HistoryHeaderDraft, value: string) {
    setHistoryDetails((current) => {
      const detail = current[orderKey];
      if (!detail) return current;
      return { ...current, [orderKey]: { ...detail, header: { ...detail.header, [field]: value } } };
    });
  }

  function updateHistoryItemField(orderKey: string, itemId: number, field: keyof HistoryItemDraft, value: string) {
    setHistoryDetails((current) => {
      const detail = current[orderKey];
      if (!detail) return current;
      return {
        ...current,
        [orderKey]: {
          ...detail,
          items: detail.items.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
        }
      };
    });
  }

  function updateNewHistoryItemField(orderKey: string, field: keyof HistoryItemDraft, value: string) {
    setHistoryDetails((current) => {
      const detail = current[orderKey];
      if (!detail) return current;
      return { ...current, [orderKey]: { ...detail, newItem: { ...detail.newItem, [field]: value } } };
    });
  }

  function updateHistoryItemSearch(orderKey: string, q: string) {
    setHistoryDetails((current) => {
      const detail = current[orderKey];
      if (!detail) return current;
      return { ...current, [orderKey]: { ...detail, q } };
    });
  }

  async function saveHistoryHeader(order: HistoryOrder) {
    const detail = historyDetails[order.order_key];
    if (!detail) return;
    setBusy(`history-header:${order.order_key}`);
    try {
      const res = await fetch(`/api/orders/${orderKeyPath(order.order_key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(detail.header)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "运单保存失败");
      const updated = data.order as HistoryOrder;
      setExpandedHistory((current) => {
        const next = new Set(current);
        next.delete(order.order_key);
        next.add(updated.order_key);
        return next;
      });
      setHistoryDetails((current) => {
        const next = { ...current };
        const currentDetail = next[order.order_key] ?? detail;
        delete next[order.order_key];
        next[updated.order_key] = { ...currentDetail, header: historyHeaderFromOrder(updated) };
        return next;
      });
      showToast("success", "运单信息已保存");
      await loadHistory(history.page);
      await loadHistoryItems(updated, detail.page, detail.q);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function createHistoryItem(orderKey: string) {
    const detail = historyDetails[orderKey];
    if (!detail) return;
    setBusy(`history-item-new:${orderKey}`);
    try {
      const res = await fetch(`/api/orders/${orderKeyPath(orderKey)}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(detail.newItem)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SKU 新增失败");
      const nextPage = detail.q.trim() ? detail.page : Math.max(Math.ceil((detail.total + 1) / detail.pageSize), 1);
      setHistoryDetails((current) => {
        const currentDetail = current[orderKey];
        if (!currentDetail) return current;
        return { ...current, [orderKey]: { ...currentDetail, newItem: emptyHistoryItemDraft() } };
      });
      showToast("success", "SKU 明细已新增");
      await loadHistory(history.page);
      await loadHistoryItems(orderKey, nextPage, detail.q);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function saveHistoryItem(orderKey: string, item: HistoryItem) {
    setBusy(`history-item:${item.id}`);
    try {
      const res = await fetch(`/api/order-items/${item.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SKU 保存失败");
      const updated = normalizeHistoryItem(data.item);
      setHistoryDetails((current) => {
        const detail = current[orderKey];
        if (!detail) return current;
        return {
          ...current,
          [orderKey]: {
            ...detail,
            items: detail.items.map((row) => (row.id === updated.id ? updated : row))
          }
        };
      });
      showToast("success", "SKU 明细已保存");
      await loadHistory(history.page);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function deleteHistoryItem(orderKey: string, itemId: number) {
    if (!window.confirm("确认删除这条 SKU 明细？")) return;
    const detail = historyDetails[orderKey];
    setBusy(`history-item-delete:${itemId}`);
    try {
      const res = await fetch(`/api/order-items/${itemId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SKU 删除失败");
      showToast("success", `已删除 ${data.deleted ?? 0} 条 SKU 明细`);
      if (!detail || detail.total <= 1) {
        setExpandedHistory((current) => {
          const next = new Set(current);
          next.delete(orderKey);
          return next;
        });
        setHistoryDetails((current) => {
          const next = { ...current };
          delete next[orderKey];
          return next;
        });
        await loadHistory(history.page);
        return;
      }
      const nextPage = detail.items.length <= 1 && detail.page > 1 ? detail.page - 1 : detail.page;
      await loadHistory(history.page);
      await loadHistoryItems(orderKey, nextPage, detail.q);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function deleteHistoryOrder(orderKey: string) {
    if (!window.confirm("确认删除这张运单及其全部 SKU 明细？")) return;
    setBusy(`history-delete:${orderKey}`);
    try {
      const res = await fetch(`/api/orders/${orderKeyPath(orderKey)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      showToast("success", `已删除 ${data.deleted ?? 0} 条 SKU 明细`);
      setExpandedHistory((current) => {
        const next = new Set(current);
        next.delete(orderKey);
        return next;
      });
      setHistoryDetails((current) => {
        const next = { ...current };
        delete next[orderKey];
        return next;
      });
      await loadHistory(history.page);
    } catch (error) {
      showToast("error", getMessage(error));
    } finally {
      setBusy("");
    }
  }

  function moveFocus(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) {
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    const nextField = event.shiftKey ? fieldIndex - 1 : fieldIndex + 1;
    const nextRow = nextField >= EDITABLE_FIELDS.length ? rowIndex + 1 : nextField < 0 ? rowIndex - 1 : rowIndex;
    const normalizedField = (nextField + EDITABLE_FIELDS.length) % EDITABLE_FIELDS.length;
    const target = document.querySelector<HTMLInputElement>(
      `[data-cell="${nextRow}:${EDITABLE_FIELDS[normalizedField]}"]`
    );
    target?.focus();
    target?.select();
  }

  function showToast(type: Toast["type"], text: string) {
    setToast({ type, text });
  }

  const visibleRange = useMemo(() => {
    const start = Math.max(Math.floor(scrollTop / ROW_HEIGHT) - 5, 0);
    const visible = Math.ceil(PREVIEW_HEIGHT / ROW_HEIGHT) + 10;
    return { start, end: Math.min(start + visible, rows.length) };
  }, [scrollTop, rows.length]);
  const visibleRows = rows.slice(visibleRange.start, visibleRange.end);

  function renderHistoryDetail(row: HistoryOrder) {
    const detail = historyDetails[row.order_key];
    const pageTotal = Math.max(Math.ceil((detail?.total ?? 0) / (detail?.pageSize ?? 8)), 1);

    return (
      <tr className="history-detail-row" key={`${row.order_key}:items`}>
        <td colSpan={8}>
          <div className="history-detail">
            {!detail || busy === `history-items:${row.order_key}` ? (
              <div className="history-loading">
                <Loader2 className="spin" size={18} />
                正在加载 SKU 明细
              </div>
            ) : (
              <>
                <div className="history-header-editor">
                  <label>
                    外部编码
                    <input value={detail.header.externalCode} onChange={(event) => updateHistoryHeaderField(row.order_key, "externalCode", event.target.value)} />
                  </label>
                  <label>
                    收货门店
                    <input value={detail.header.storeName} onChange={(event) => updateHistoryHeaderField(row.order_key, "storeName", event.target.value)} />
                  </label>
                  <label>
                    收件人
                    <input value={detail.header.receiverName} onChange={(event) => updateHistoryHeaderField(row.order_key, "receiverName", event.target.value)} />
                  </label>
                  <label>
                    电话
                    <input value={detail.header.receiverPhone} onChange={(event) => updateHistoryHeaderField(row.order_key, "receiverPhone", event.target.value)} />
                  </label>
                  <label className="wide">
                    收货地址
                    <input value={detail.header.receiverAddress} onChange={(event) => updateHistoryHeaderField(row.order_key, "receiverAddress", event.target.value)} />
                  </label>
                  <button className="soft-button" disabled={Boolean(busy)} onClick={() => saveHistoryHeader(row)}>
                    {busy === `history-header:${row.order_key}` ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                    保存运单
                  </button>
                </div>

                <div className="history-detail-meta">
                  <span>批次：{row.batch_id}</span>
                  <span>源文件：{row.source_file || "-"}</span>
                  <span>SKU 总数：{detail.total}</span>
                </div>

                <form
                  className="history-item-toolbar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadHistoryItems(row.order_key, 1, detail.q);
                  }}
                >
                  <input
                    placeholder="搜索 SKU 编码、名称、规格、备注"
                    value={detail.q}
                    onChange={(event) => updateHistoryItemSearch(row.order_key, event.target.value)}
                  />
                  <button className="soft-button" type="submit">
                    查询
                  </button>
                  <span>
                    第 {detail.page} / {pageTotal} 页
                  </span>
                </form>

                <div className="history-detail-table">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU编码</th>
                        <th>SKU名称</th>
                        <th>规格</th>
                        <th>数量</th>
                        <th>备注</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <input value={item.skuCode} onChange={(event) => updateHistoryItemField(row.order_key, item.id, "skuCode", event.target.value)} />
                          </td>
                          <td>
                            <input value={item.skuName} onChange={(event) => updateHistoryItemField(row.order_key, item.id, "skuName", event.target.value)} />
                          </td>
                          <td>
                            <input value={item.spec ?? ""} onChange={(event) => updateHistoryItemField(row.order_key, item.id, "spec", event.target.value)} />
                          </td>
                          <td>
                            <input value={item.quantity} onChange={(event) => updateHistoryItemField(row.order_key, item.id, "quantity", event.target.value)} />
                          </td>
                          <td>
                            <input value={item.remark ?? ""} onChange={(event) => updateHistoryItemField(row.order_key, item.id, "remark", event.target.value)} />
                          </td>
                          <td>
                            <div className="row-actions">
                              <button className="icon-button" title="保存 SKU" disabled={Boolean(busy)} onClick={() => saveHistoryItem(row.order_key, item)}>
                                {busy === `history-item:${item.id}` ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                              </button>
                              <button
                                className="icon-button danger"
                                title="删除 SKU"
                                disabled={Boolean(busy)}
                                onClick={() => deleteHistoryItem(row.order_key, item.id)}
                              >
                                {busy === `history-item-delete:${item.id}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="new-item-row">
                        <td>
                          <input
                            placeholder="新增编码"
                            value={detail.newItem.skuCode}
                            onChange={(event) => updateNewHistoryItemField(row.order_key, "skuCode", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            placeholder="新增名称"
                            value={detail.newItem.skuName}
                            onChange={(event) => updateNewHistoryItemField(row.order_key, "skuName", event.target.value)}
                          />
                        </td>
                        <td>
                          <input value={detail.newItem.spec} onChange={(event) => updateNewHistoryItemField(row.order_key, "spec", event.target.value)} />
                        </td>
                        <td>
                          <input value={detail.newItem.quantity} onChange={(event) => updateNewHistoryItemField(row.order_key, "quantity", event.target.value)} />
                        </td>
                        <td>
                          <input value={detail.newItem.remark} onChange={(event) => updateNewHistoryItemField(row.order_key, "remark", event.target.value)} />
                        </td>
                        <td>
                          <button className="soft-button" disabled={Boolean(busy)} onClick={() => createHistoryItem(row.order_key)}>
                            {busy === `history-item-new:${row.order_key}` ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
                            新增
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="pager detail-pager">
                  <span>
                    共 {detail.total} 条 SKU，第 {detail.page} / {pageTotal} 页
                  </span>
                  <button className="soft-button" disabled={detail.page <= 1} onClick={() => loadHistoryItems(row.order_key, detail.page - 1, detail.q)}>
                    上一页
                  </button>
                  <button className="soft-button" disabled={detail.page >= pageTotal} onClick={() => loadHistoryItems(row.order_key, detail.page + 1, detail.q)}>
                    下一页
                  </button>
                </div>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="zt-frame">
      <header className="zt-navbar">
        <div className="zt-brand">
          <div className="zt-logo">ZTO</div>
          <div className="zt-brand-text">
            <strong>中通冷链</strong>
            <span>ZTO COLD CHAIN</span>
          </div>
        </div>
        <nav className="zt-product-tabs" aria-label="业务系统">
          <button>冷链智运</button>
          <button className="active">冷链快运</button>
        </nav>
        <div className="zt-nav-actions">
          <span>返回旧版</span>
          <span>快件跟踪</span>
          <span className="with-badge">
            <CalendarCheck size={15} />
            待办
            <b>27</b>
          </span>
          <span className="with-badge">
            <Bell size={15} />
            消息
            <b>99+</b>
          </span>
          <span>导出</span>
          <span>下载</span>
          <span>工单</span>
          <span>反馈</span>
          <span>喜喜</span>
          <Settings size={17} />
        </div>
      </header>

      <div className="zt-layout">
        <aside className="zt-sidebar">
          <div className="zt-org">
            <Menu size={18} />
            <span>总部</span>
            <ChevronDown size={16} />
          </div>
          <label className="zt-menu-search">
            <Search size={17} />
            <input placeholder="输入菜单名称" readOnly />
          </label>
          <nav className="zt-menu" aria-label="主菜单">
            <a>
              <Home size={19} />
              首页
            </a>
            <a>
              <Folder size={19} />
              PDA操作管理
            </a>
            <a>
              <ClipboardCheck size={19} />
              OMS订单中心
            </a>
            <a>
              <Folder size={19} />
              基础管理
            </a>
            <a>
              <RefreshCw size={19} />
              仓链重构
            </a>
            <a>
              <Folder size={19} />
              工作台
            </a>
            <a className="active">
              <Folder size={19} />
              经营管理中心
            </a>
            <a>
              <Folder size={19} />
              冷链财务管理
            </a>
            <a>
              <Folder size={19} />
              数据预警
            </a>
            <a>
              <Download size={19} />
              中通冷链业务员APP
            </a>
          </nav>
          <div className="zt-env-switch">
            <span>预发环境</span>
            <i />
          </div>
          <nav className="zt-menu zt-menu-bottom" aria-label="辅助菜单">
            <a>
              <Folder size={19} />
              仓储中心
            </a>
            <a>
              <Folder size={19} />
              测试二级目录2
            </a>
          </nav>
        </aside>

        <section className="zt-content">
          <div className="zt-content-tabs">
            <button className="zt-collapse">《</button>
            <div className="zt-tab-active">订单管理 <span>×</span></div>
            <div className="zt-tab-tools">
              <RefreshCw size={17} />
              <ChevronDown size={18} />
            </div>
          </div>

          <main className="app-shell">
      <section className="topbar">
        <div>
          <div className="eyebrow">智能多格式批量下单系统 V2</div>
          <h1>万能导入工作台</h1>
        </div>
        <div className="top-actions">
          <StatusPill label="规则" value={`${rules.length} 条`} />
          <StatusPill label="预览" value={`${rows.length} 行`} />
          <StatusPill label="错误" value={`${errors.length} 个`} tone={errors.length ? "danger" : "ok"} />
        </div>
      </section>

      <section className="flow-card">
        {["上传文件", "选择或生成规则", "试解析预览", "校验编辑", "提交下单"].map((item, index) => (
          <div className={cn("flow-step", progress.percent > index * 20 && "active")} key={item}>
            <span>{index + 1}</span>
            {item}
          </div>
        ))}
        <div className="progress-track" aria-label={progress.label}>
          <div style={{ width: `${progress.percent}%` }} />
        </div>
        <strong>{progress.percent}%</strong>
        <em>{progress.label}</em>
      </section>

      <section className="workspace-grid">
        <aside className="side-panel">
          <PanelTitle icon={<UploadCloud size={18} />} title="文件导入" />
          <div
            className={cn("dropzone", busy === "file" && "is-busy")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy === "file" ? <Loader2 className="spin" size={34} /> : <FileSpreadsheet size={34} />}
            <strong>{fileName || "拖拽或点击上传文件"}</strong>
            <span>支持 Excel、Word、PDF；解析后手动选择规则</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.docx,.pdf"
              hidden
              onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files && handleFiles(event.target.files)}
            />
          </div>
          {stats && (
            <div className="stat-grid">
              <StatusPill label="类型" value={stats.type} />
              <StatusPill label="Sheet" value={String(stats.sheets)} />
              <StatusPill label="源行" value={String(stats.rows)} />
            </div>
          )}

          <PanelTitle icon={<ClipboardCheck size={18} />} title="解析规则" />
          <div className="rule-toolbar">
            <select value={selectedRuleId} onChange={(event) => onRuleSelect(event.target.value)}>
              <option value="">未选择，编辑草案</option>
              {rules.map((rule) => (
                <option value={rule.id} key={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
            <button className="icon-button" title="新建规则" onClick={newRule}>
              <Plus size={16} />
            </button>
            <button className="icon-button" title="复制规则" onClick={duplicateRule}>
              <Copy size={16} />
            </button>
            <button className="icon-button danger" title="删除规则" disabled={!selectedRuleId} onClick={deleteSelectedRule}>
              <Trash2 size={16} />
            </button>
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={!source || Boolean(busy)} onClick={generateRule}>
              {busy === "ai" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              AI 生成规则
            </button>
            <button className="soft-button" disabled={Boolean(busy)} onClick={saveRule}>
              {busy === "save-rule" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              保存
            </button>
          </div>

          {!!aiNotes.length && (
            <div className="note-box">
              <strong>AI 推测说明</strong>
              {aiNotes.slice(0, 4).map((note) => (
                <span key={note}>{note}</span>
              ))}
            </div>
          )}

          <textarea
            className="rule-editor"
            spellCheck={false}
            value={ruleText}
            onChange={(event) => setRuleText(event.target.value)}
            onBlur={() => {
              const parsed = parseRuleText();
              if (parsed) setRuleDraft(parsed);
            }}
          />
          <div className="button-row">
            <button className="primary-button full" disabled={!source || Boolean(busy)} onClick={previewParse}>
              {busy === "parse" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              试解析并预览
            </button>
          </div>
        </aside>

        <section className="main-panel">
          <div className="panel-head">
            <PanelTitle icon={<FileSpreadsheet size={18} />} title="数据预览与在线编辑" />
            <div className="button-row compact">
              <button className="soft-button" onClick={addRow}>
                <Plus size={16} />
                新增行
              </button>
              <button className="soft-button" onClick={exportExcel}>
                <Download size={16} />
                导出 Excel
              </button>
              <button className="primary-button" disabled={Boolean(busy) || !rows.length} onClick={submitOrders}>
                {busy === "submit" ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                提交下单
              </button>
            </div>
          </div>

          <div className="preview-meta">
            <span>{metrics || "上传文件并选择规则后，这里会展示类 Excel 预览。"}</span>
            <span>{warnings.length ? `提示 ${warnings.length} 个` : "实时校验已开启"}</span>
          </div>

          <div className="error-summary">
            {errors.length ? (
              <>
                <AlertCircle size={16} />
                <div>
                  <strong>发现 {errors.length} 个错误，提交前需全部修正</strong>
                  <p>{errors.slice(0, 5).map((issue) => `第${issue.rowNo}行 ${FIELD_LABELS[issue.field]}：${issue.message}`).join("；")}</p>
                </div>
              </>
            ) : rows.length ? (
              <>
                <CheckCircle2 size={16} />
                <div>
                  <strong>当前没有阻断提交的错误</strong>
                  <p>{warnings.length ? `仍有 ${warnings.length} 个重复或风险提示。` : "可继续核对后提交下单。"}</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle size={16} />
                <div>
                  <strong>暂无预览数据</strong>
                  <p>解析失败时请查看源文件样本，并通过新建规则入口手动配置。</p>
                </div>
              </>
            )}
          </div>

          <div className="table-wrap" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <table className="preview-table">
              <thead>
                <tr>
                  <th className="row-number">#</th>
                  {EDITABLE_FIELDS.map((field) => (
                    <th key={field}>{FIELD_LABELS[field]}</th>
                  ))}
                  <th className="op-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRange.start > 0 && (
                  <tr style={{ height: visibleRange.start * ROW_HEIGHT }}>
                    <td colSpan={EDITABLE_FIELDS.length + 2} />
                  </tr>
                )}
                {visibleRows.map((row, localIndex) => {
                  const realIndex = visibleRange.start + localIndex;
                  return (
                    <tr key={row.id} style={{ height: ROW_HEIGHT }}>
                      <td className="row-number">{realIndex + 1}</td>
                      {EDITABLE_FIELDS.map((field, fieldIndex) => {
                        const cellIssues = mappedIssues.get(`${row.id}:${field}`) ?? [];
                        return (
                          <td className={cn(cellIssues.length > 0 && "cell-error")} key={field} title={cellIssues[0]?.message}>
                            <input
                              data-cell={`${realIndex}:${field}`}
                              value={row[field]}
                              onKeyDown={(event) => moveFocus(event, realIndex, fieldIndex)}
                              onChange={(event) => updateCell(row.id, field, event.target.value)}
                            />
                          </td>
                        );
                      })}
                      <td className="op-col">
                        <button className="icon-button danger" title="删除行" onClick={() => removeRow(row.id)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleRange.end < rows.length && (
                  <tr style={{ height: (rows.length - visibleRange.end) * ROW_HEIGHT }}>
                    <td colSpan={EDITABLE_FIELDS.length + 2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="history-panel">
        <div className="panel-head">
          <PanelTitle icon={<History size={18} />} title="已导入运单" />
          <form
            className="history-search"
            onSubmit={(event) => {
              event.preventDefault();
              void loadHistory(1, historyQuery);
            }}
          >
            <input
              placeholder="按外部编码、收件人、门店搜索"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
            />
            <button className="soft-button" type="submit">
              查询
            </button>
          </form>
        </div>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>外部编码</th>
                <th>收货门店</th>
                <th>收件人</th>
                <th>电话</th>
                <th>SKU 明细</th>
                <th>数量合计</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <Fragment key={row.order_key}>
                  <tr key={row.order_key}>
                    <td>
                      <button className="history-expand" onClick={() => toggleHistory(row)} title="查看 SKU 明细">
                        {expandedHistory.has(row.order_key) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span>{row.external_code || "无外部编码"}</span>
                      </button>
                    </td>
                    <td>{row.store_name || "-"}</td>
                    <td>{row.receiver_name || "-"}</td>
                    <td>{row.receiver_phone || "-"}</td>
                    <td>
                      <strong>{row.sku_count} 条 SKU</strong>
                      <span>{row.source_file || row.batch_id}</span>
                    </td>
                    <td>{row.total_quantity}</td>
                    <td>{new Date(row.created_at).toLocaleString("zh-CN")}</td>
                    <td>
                      <button
                        className="icon-button danger"
                        title="删除整张运单"
                        disabled={busy === `history-delete:${row.order_key}`}
                        onClick={() => deleteHistoryOrder(row.order_key)}
                      >
                        {busy === `history-delete:${row.order_key}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                      </button>
                    </td>
                  </tr>
                  {expandedHistory.has(row.order_key) && renderHistoryDetail(row)}
                </Fragment>
              ))}
              {!history.rows.length && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    暂无历史运单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>
            共 {history.total} 条，第 {history.page} / {Math.max(Math.ceil(history.total / history.pageSize), 1)} 页
          </span>
          <button className="soft-button" disabled={history.page <= 1} onClick={() => loadHistory(history.page - 1)}>
            上一页
          </button>
          <button
            className="soft-button"
            disabled={history.page >= Math.ceil(history.total / history.pageSize)}
            onClick={() => loadHistory(history.page + 1)}
          >
            下一页
          </button>
        </div>
      </section>

          </main>
        </section>
      </div>

      {toast && <div className={cn("toast", toast.type)}>{toast.text}</div>}
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className={cn("status-pill", tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function orderKeyPath(orderKey: string) {
  return encodeURIComponent(orderKey);
}

function emptyHistoryHeader(): HistoryHeaderDraft {
  return {
    externalCode: "",
    storeName: "",
    receiverName: "",
    receiverPhone: "",
    receiverAddress: ""
  };
}

function emptyHistoryItemDraft(): HistoryItemDraft {
  return {
    skuCode: "",
    skuName: "",
    quantity: "1",
    spec: "",
    remark: ""
  };
}

function historyHeaderFromOrder(order: HistoryOrder): HistoryHeaderDraft {
  return {
    externalCode: order.external_code ?? "",
    storeName: order.store_name ?? "",
    receiverName: order.receiver_name ?? "",
    receiverPhone: order.receiver_phone ?? "",
    receiverAddress: order.receiver_address ?? ""
  };
}

function normalizeHistoryItem(input: Record<string, unknown>): HistoryItem {
  return {
    id: Number(input.id),
    skuCode: String(input.skuCode ?? input.sku_code ?? ""),
    skuName: String(input.skuName ?? input.sku_name ?? ""),
    quantity: String(input.quantity ?? ""),
    spec: input.spec == null ? null : String(input.spec),
    remark: input.remark == null ? null : String(input.remark),
    created_at: String(input.created_at ?? "")
  };
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
