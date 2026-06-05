import { NextResponse } from "next/server";
import { deleteRule, updateRule } from "@/lib/db";
import { ParseRule } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { rule: ParseRule; description?: string };
    if (!body.rule?.name) {
      return NextResponse.json({ error: "规则名称不能为空" }, { status: 400 });
    }
    const rule = await updateRule(Number(id), body.rule, body.description);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteRule(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
