import { NextResponse } from "next/server";
import { deleteOrderGroup, getOrderGroup, updateOrderGroupHeader } from "@/lib/db";

type RouteContext = { params: Promise<{ orderKey: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { orderKey } = await context.params;
    const order = await getOrderGroup(safeDecode(orderKey));
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { orderKey } = await context.params;
    const body = await request.json();
    const order = await updateOrderGroupHeader(safeDecode(orderKey), {
      externalCode: String(body.externalCode ?? ""),
      storeName: String(body.storeName ?? ""),
      receiverName: String(body.receiverName ?? ""),
      receiverPhone: String(body.receiverPhone ?? ""),
      receiverAddress: String(body.receiverAddress ?? "")
    });
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { orderKey } = await context.params;
    const result = await deleteOrderGroup(safeDecode(orderKey));
    return NextResponse.json(result);
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
