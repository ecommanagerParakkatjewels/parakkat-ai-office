// Daily scheduled agent run. Vercel Cron calls this with
// "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET set, it refuses.
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAgents } from "@/lib/agents/run";
import { shopifyStatus } from "@/lib/shopify/client";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await shopifyStatus()).connected) return NextResponse.json({ ok: false, error: "shopify not connected" }, { status: 503 });
  const tenant = await currentTenant();
  const r = await runAgents(tenant.id, "schedule", "schedule");
  return NextResponse.json({ ok: r.started, ran: r.results.length, failed: r.results.filter((x) => x.status === "failed").length });
}
