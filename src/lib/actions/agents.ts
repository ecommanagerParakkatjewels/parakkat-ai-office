"use server";
import { redirect } from "next/navigation";
import { runAgents } from "@/lib/agents/run";
import { shopifyConfigured } from "@/lib/shopify/client";
import { currentTenant } from "@/lib/tenant";
import { currentUser } from "@/lib/supabase/server";
import type { ActionResult } from "./findings";

export async function runAgentsNow(_: ActionResult | null, _form: FormData): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!shopifyConfigured()) return { ok: false, error: "Shopify access is not set up yet, so the agents have nothing to read." };
  const tenant = await currentTenant();
  const r = await runAgents(tenant.id, "manual", user.email ?? user.id);
  if (!r.started) return { ok: false, error: r.reason ?? "Could not start." };
  const failed = r.results.filter((x) => x.status === "failed");
  if (failed.length === r.results.length) return { ok: false, error: "Every agent failed: " + (failed[0]?.error ?? "unknown error") };
  return { ok: true };
}
