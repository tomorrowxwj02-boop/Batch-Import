import { NextResponse } from "next/server";
import { deleteOrderItem, updateOrderItem } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const item = await updateOrderItem(Number(id), {
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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await deleteOrderItem(Number(id));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
