import { NextResponse } from "next/server";
import { findExistingOrderDuplicates } from "@/lib/db";
import { DuplicateLookupRow } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { codes?: string[]; rows?: DuplicateLookupRow[] };
    const lookupRows = body.rows?.length ? body.rows : (body.codes ?? []).map((code) => ({ externalCode: code }));
    const duplicates = await findExistingOrderDuplicates(lookupRows);
    return NextResponse.json({ ...duplicates, codes: duplicates.externalCodes });
  } catch (error) {
    return NextResponse.json({ error: getMessage(error) }, { status: 500 });
  }
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
