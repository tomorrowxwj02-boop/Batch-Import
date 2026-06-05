import { NextResponse } from "next/server";
import { createRule, listRules } from "@/lib/db";
import { ParseRule } from "@/lib/types";

export async function GET() {
  try {
    const rules = await listRules();
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rule: ParseRule; description?: string };
    if (!body.rule?.name) {
      return NextResponse.json({ error: "规则名称不能为空" }, { status: 400 });
    }
    const rule = await createRule(body.rule, body.description);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
