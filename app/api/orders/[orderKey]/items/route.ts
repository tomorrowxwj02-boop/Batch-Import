import { NextResponse } from "next/server";
import { createOrderItem, listOrderItems } from "@/lib/db";

type RouteContext = { params: Promise<{ orderKey: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { orderKey } = await context.params;
    const { searchParams } = new URL(request.url);
    const result = await listOrderItems({
      orderKey: safeDecode(orderKey),
      q: searchParams.get("q") ?? undefined,
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 8)
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { orderKey } = await context.params;
    const body = await request.json();
    const item = await createOrderItem(safeDecode(orderKey), {
      skuCode: String(body.skuCode ?? ""),
      skuName: String(body.skuName ?? ""),
      quantity: String(body.quantity ?? ""),
      spec: String(body.spec ?? ""),
      remark: String(body.remark ?? "")
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
