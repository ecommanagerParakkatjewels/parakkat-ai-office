// Answers "is the database reachable and migrated" without exposing anything.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<{ n: string }>("select count(*)::text as n from office.tenants");
    return NextResponse.json({ ok: true, tenants: Number(rows[0]?.n ?? 0) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 503 });
  }
}
