// Answers "is the database reachable and migrated" without exposing anything.
// Public endpoint: the reason for a failure goes to the server log, never the response.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A short, non-sensitive category for the log line; the full error stays in the log only. */
function category(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/password authentication failed/i.test(m)) return "auth";
  if (/certificate|self[- ]signed|SSL|TLS/i.test(m)) return "tls";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return "network";
  if (/does not exist/i.test(m)) return "not_migrated";
  if (/DATABASE_URL is not set/i.test(m)) return "not_configured";
  return "other";
}

export async function GET() {
  try {
    const rows = await query<{ n: string }>("select count(*)::text as n from office.tenants");
    return NextResponse.json({ ok: true, tenants: Number(rows[0]?.n ?? 0) });
  } catch (e) {
    console.error("health: database check failed", category(e), e);
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
