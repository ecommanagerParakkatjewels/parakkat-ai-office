"use server";
// Every status change goes through here. The database holds the rules; these
// functions only validate input, record who acted, and translate a refusal
// into a message the screen can show.
import { redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { currentUser } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function actor() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user.email ?? user.id;
}

/** Turn a Postgres refusal into plain words. The constraint names are ours. */
function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const rules: [RegExp, string][] = [
    [/illegal transition (\w+) -> (\w+)/, "That step is not allowed from the finding's current status."],
    [/triage needs/, "Triage needs an area, a severity and a root cause."],
    [/assignment needs/, "Assignment needs an owner and a proposed fix."],
    [/accepting a risk needs a reason/, "Accepting a risk needs a reason."],
    [/no clean check run recorded after the fix/, "Cannot close: no clean check run has been recorded since the fix was reported."],
    [/no prevention rule in force/, "Cannot close: no prevention rule is in force."],
    [/findings_tenant_id_fingerprint_key/, "A finding with that identity already exists in this brand."],
    [/scope_count.*scope_counted_at|findings_check/, "A count needs the date it was counted."],
    [/check_runs_check/, "A run marked clean cannot still match anything."],
    [/violates foreign key/, "That owner does not belong to this brand."],
  ];
  for (const [re, msg] of rules) if (re.test(m)) return msg;
  return "The database refused the change: " + m.replace(/^error: /, "");
}

async function run(fn: (c: Parameters<Parameters<typeof withActor>[1]>[0], tenantId: string) => Promise<void>): Promise<ActionResult> {
  const who = await actor();
  const tenant = await currentTenant();
  try {
    await withActor(who, (c) => fn(c, tenant.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

const Id = z.string().uuid();

// ---------------------------------------------------------------- triage
const TriageIn = z.object({
  id: Id,
  area: z.enum(["catalogue", "seo_content", "pricing_offers", "shipping_rto", "checkout_carts", "marketing_spend", "site_tech"]),
  severity: z.enum(["S1", "S2", "S3", "S4"]),
  root_cause: z.string().trim().min(10).max(2000),
  scope_count: z.coerce.number().int().min(0).optional().or(z.literal("").transform(() => undefined)),
  scope_unit: z.string().trim().max(40).optional(),
  scope_counted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});
export async function triage(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = TriageIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = p.data;
  if (d.scope_count !== undefined && !d.scope_counted_at) return { ok: false, error: "A count needs the date it was counted." };
  return run(async (c, t) => {
    await c.query(
      `update office.findings set status = 'triaged', area = $3, severity = $4, root_cause = $5,
              scope_count = coalesce($6, scope_count), scope_unit = coalesce($7, scope_unit), scope_counted_at = coalesce($8, scope_counted_at)
        where id = $1 and tenant_id = $2`,
      [d.id, t, d.area, d.severity, d.root_cause, d.scope_count ?? null, d.scope_unit || null, d.scope_counted_at ?? null]
    );
  });
}

// ---------------------------------------------------------------- assign
const AssignIn = z.object({ id: Id, owner_id: Id, proposed_fix: z.string().trim().min(5).max(2000), due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)) });
export async function assign(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = AssignIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Pick an owner and write the proposed fix." };
  const d = p.data;
  return run(async (c, t) => {
    await c.query(
      `update office.findings set status = 'assigned', owner_id = $3, proposed_fix = $4, due_on = $5 where id = $1 and tenant_id = $2`,
      [d.id, t, d.owner_id, d.proposed_fix, d.due_on ?? null]
    );
  });
}

// ---------------------------------------------------------------- simple transitions
const JustId = z.object({ id: Id });
function simple(to: string) {
  return async (_: ActionResult | null, form: FormData): Promise<ActionResult> => {
    const p = JustId.safeParse(Object.fromEntries(form));
    if (!p.success) return { ok: false, error: "Bad request." };
    return run(async (c, t) => {
      await c.query(`update office.findings set status = $3 where id = $1 and tenant_id = $2`, [p.data.id, t, to]);
    });
  };
}
export const reportFixed = simple("fix_reported");
export const startVerifying = simple("verifying");
export const sendBack = simple("assigned");
export const close = simple("closed");
export const reopen = simple("recurred");

const AcceptIn = z.object({ id: Id, accepted_reason: z.string().trim().min(10).max(1000) });
export async function acceptRisk(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = AcceptIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Accepting a risk needs a reason of at least ten characters." };
  return run(async (c, t) => {
    await c.query(`update office.findings set status = 'accepted', accepted_reason = $3 where id = $1 and tenant_id = $2`, [p.data.id, t, p.data.accepted_reason]);
  });
}

// ---------------------------------------------------------------- owners
const OwnerIn = z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(["team", "person"]).default("team") });
export async function addOwner(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = OwnerIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "An owner needs a name of 2–80 characters." };
  return run(async (c, t) => {
    await c.query(`insert into office.owners (tenant_id, name, kind) values ($1, $2, $3) on conflict (tenant_id, name) do nothing`, [t, p.data.name, p.data.kind]);
  });
}

// ---------------------------------------------------------------- checks and runs
const CheckIn = z.object({ finding_id: Id, name: z.string().trim().min(3).max(80), description: z.string().trim().min(10).max(1000) });
export async function createCheck(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = CheckIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "A check needs a short name and a description of what it counts." };
  return run(async (c, t) => {
    await c.query(`insert into office.checks (tenant_id, finding_id, name, description, kind) values ($1, $2, $3, $4, 'manual')`, [t, p.data.finding_id, p.data.name, p.data.description]);
  });
}

const RunIn = z.object({
  check_id: Id,
  matched_count: z.coerce.number().int().min(0),
  sample: z.string().trim().max(4000).default(""),
  note: z.string().trim().max(1000).default(""),
});
export async function recordRun(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = RunIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "A run needs the number of items that still match (0 if none)." };
  const d = p.data;
  const sample = d.sample ? d.sample.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
  const who = await actor();
  return run(async (c, t) => {
    await c.query(
      `insert into office.check_runs (tenant_id, check_id, matched_count, sample, result, note, run_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [t, d.check_id, d.matched_count, JSON.stringify(sample), d.matched_count === 0 ? "clean" : "still_matching", d.note || null, who]
    );
  });
}

// ---------------------------------------------------------------- prevention rules
const RuleIn = z.object({ finding_id: Id, rule: z.string().trim().min(10).max(1000) });
export async function proposeRule(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = RuleIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "A prevention rule needs at least ten characters." };
  return run(async (c, t) => {
    await c.query(`insert into office.prevention_rules (tenant_id, finding_id, rule, proposed_by) values ($1, $2, $3, 'human')`, [t, p.data.finding_id, p.data.rule]);
  });
}
const RuleId = z.object({ rule_id: Id });
export async function acceptRule(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = RuleId.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Bad request." };
  return run(async (c, t) => {
    await c.query(`update office.prevention_rules set status = 'in_force', accepted_at = now() where id = $1 and tenant_id = $2 and status = 'proposed'`, [p.data.rule_id, t]);
  });
}
