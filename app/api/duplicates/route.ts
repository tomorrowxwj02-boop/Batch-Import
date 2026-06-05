import { NextResponse } from "next/server";
import { findExistingExternalCodes } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { codes?: string[] };
    const codes = await findExistingExternalCodes(body.codes ?? []);
    return NextResponse.json({ codes });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
