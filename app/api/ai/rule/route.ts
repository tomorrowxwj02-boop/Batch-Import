import { NextResponse } from "next/server";
import { generateRuleWithLLM } from "@/lib/ai";
import { ParsedSource } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { source: ParsedSource };
    if (!body.source) {
      return NextResponse.json({ error: "缺少文件样本" }, { status: 400 });
    }
    const result = await generateRuleWithLLM(body.source);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
