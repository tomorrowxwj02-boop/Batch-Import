"use client";

import { ParsedSource } from "@/lib/types";
import { toText } from "@/lib/utils";

export async function parseFileToSource(file: File, onProgress?: (percent: number, label: string) => void): Promise<ParsedSource> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  onProgress?.(8, "读取文件");
  if (ext === "xlsx" || ext === "xls") return parseExcel(file, onProgress);
  if (ext === "docx") return parseDocx(file, onProgress);
  if (ext === "pdf") return parsePdf(file, onProgress);
  throw new Error("仅支持 .xlsx/.xls/.docx/.pdf 文件");
}

async function parseExcel(file: File, onProgress?: (percent: number, label: string) => void): Promise<ParsedSource> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  onProgress?.(35, "解析工作簿");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
  const sheets = workbook.SheetNames.map((name, index) => {
    onProgress?.(35 + Math.round(((index + 1) / workbook.SheetNames.length) * 45), `读取 Sheet：${name}`);
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false
    });
    return {
      name,
      rows: rows.map((row) => row.map((cell) => (cell === undefined ? null : (cell as string | number | boolean | null))))
    };
  });
  if (!sheets.length || sheets.every((sheet) => sheet.rows.length === 0)) throw new Error("文件为空，未读取到有效工作表");
  onProgress?.(100, "工作簿解析完成");
  return { kind: "workbook", fileName: file.name, sheets };
}

async function parseDocx(file: File, onProgress?: (percent: number, label: string) => void): Promise<ParsedSource> {
  const mammoth = await import("mammoth/mammoth.browser");
  const buffer = await file.arrayBuffer();
  onProgress?.(45, "提取 Word 文本");
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value.trim();
  if (!text) throw new Error("Word 文件未提取到可解析文本");
  onProgress?.(100, "Word 文本解析完成");
  return { kind: "text", fileName: file.name, text };
}

async function parsePdf(file: File, onProgress?: (percent: number, label: string) => void): Promise<ParsedSource> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  onProgress?.(35, "读取 PDF");
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true } as any);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    onProgress?.(35 + Math.round((pageNo / pdf.numPages) * 55), `提取 PDF 第 ${pageNo}/${pdf.numPages} 页`);
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? toText(item.str) : "")).join(" ");
    pages.push(text);
  }
  const text = pages.join("\n\n--- PAGE ---\n\n").trim();
  if (!text) throw new Error("PDF 未提取到可解析文本，可能是扫描件");
  onProgress?.(100, "PDF 文本解析完成");
  return { kind: "text", fileName: file.name, text, pages };
}

export function sampleSource(source: ParsedSource): ParsedSource {
  if (source.kind === "text") {
    return { ...source, text: source.text.slice(0, 18000), pages: source.pages?.slice(0, 3) };
  }
  return {
    ...source,
    sheets: source.sheets.slice(0, 6).map((sheet) => ({
      ...sheet,
      rows: sheet.rows.slice(0, 40).map((row) => row.slice(0, 50))
    }))
  };
}

export function sourceStats(source: ParsedSource) {
  if (source.kind === "text") {
    return {
      sheets: 0,
      rows: source.text.split(/\n+/).filter(Boolean).length,
      type: "文本/PDF"
    };
  }
  return {
    sheets: source.sheets.length,
    rows: source.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    type: "Excel"
  };
}
