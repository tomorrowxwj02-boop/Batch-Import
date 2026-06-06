import { NextResponse } from "next/server";
import { deleteOrderGroup, findExistingOrderDuplicates, insertOrders, listOrders } from "@/lib/db";
import { OrderRow } from "@/lib/types";
import { validateRows } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await listOrders({
      q: searchParams.get("q") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20)
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows: OrderRow[]; sourceFile?: string };
    const rows = body.rows ?? [];
    const localIssues = validateRows(rows);
    if (localIssues.some((issue) => issue.severity === "error")) {
      return NextResponse.json({ error: "存在未修正的错误行", issues: localIssues }, { status: 400 });
    }

    const duplicates = await findExistingOrderDuplicates(rows);
    const duplicateContext = {
      existingExternalCodes: new Set(duplicates.externalCodes),
      existingLineKeys: new Set(duplicates.lineKeys)
    };
    const issues = validateRows(rows, duplicateContext);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) {
      return NextResponse.json({ error: "存在未修正的错误行", issues }, { status: 400 });
    }

    const result = await insertOrders({ rows, sourceFile: body.sourceFile });
    if (result.failed.length) {
      return NextResponse.json({ error: "部分 SKU 提交失败", ...result }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderKey = searchParams.get("orderKey");
    if (!orderKey) {
      return NextResponse.json({ error: "缺少运单标识" }, { status: 400 });
    }
    const result = await deleteOrderGroup(orderKey);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
