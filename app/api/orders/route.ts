import { NextResponse } from "next/server";
import { insertOrders, listOrders } from "@/lib/db";
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
    const issues = validateRows(rows).filter((issue) => issue.severity === "error");
    if (issues.length) {
      return NextResponse.json({ error: "存在未修正的错误行", issues }, { status: 400 });
    }
    const result = await insertOrders({ rows, sourceFile: body.sourceFile });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
