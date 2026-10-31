import "server-only";
import { query } from "./db";

export type Status = "new" | "triaged" | "assigned" | "fix_reported" | "verifying" | "closed" | "accepted" | "recurred";

export const AREA_LABEL: Record<string, string> = {
  catalogue: "Catalogue", seo_content: "SEO & content", pricing_offers: "Pricing & offers",
  shipping_rto: "Shipping & RTO", checkout_carts: "Checkout & carts", marketing_spend: "Marketing spend", site_tech: "Site & technical",
};

export const STATUS_LABEL: Record<Status, string> = {
  new: "New", triaged: "Triaged", assigned: "Assigned", fix_reported: "Fix reported",
  verifying: "Verifying", closed: "Closed", accepted: "Accepted", recurred: "Recurred",
};

/** The one legal action a human can take next, decided by status. */
export function nextAction(status: Status): { label: string; primary?: boolean; danger?: boolean } {
  switch (status) {
    case "new": return { label: "Triage" };
    case "triaged": return { label: "Assign" };
    case "assigned": return { label: "Chase" };
    case "fix_reported": return { label: "Verify", primary: true };
    case "verifying": return { label: "Open" };
    case "closed": return { label: "Re-check" };
    case "accepted": return { label: "Review" };
    case "recurred": return { label: "Reopen", danger: true };
  }
}

export type FindingRow = {
  id: string; ref: string; title: string; area: string | null; severity: string | null; status: Status;
  scope_count: number | null; scope_unit: string | null; scope_counted_at: string | null;
  owner_name: string | null; recurrence_count: number; age_hours: number;
};

export async function listFindings(tenantId: string, filter: "needs_you" | "open" | "waiting" | "closed" | "recurred" | "all") {
  const where: Record<typeof filter, string> = {
    needs_you: "f.status in ('new','triaged','fix_reported','verifying','recurred')",
    open: "f.status not in ('closed','accepted')",
    waiting: "f.status = 'assigned'",
    closed: "f.status in ('closed','accepted')",
    recurred: "f.status = 'recurred'",
    all: "true",
  };
  return query<FindingRow>(
    `select f.id, f.ref, f.title, f.area::text as area, f.severity::text as severity, f.status::text as status,
            f.scope_count, f.scope_unit, f.scope_counted_at::text as scope_counted_at,
            o.name as owner_name, f.recurrence_count,
            extract(epoch from now() - coalesce(f.assigned_at, f.created_at)) / 3600 as age_hours
       from office.findings f
       left join office.owners o on o.id = f.owner_id
      where f.tenant_id = $1 and ${where[filter]}
      order by case f.severity when 'S1' then 1 when 'S2' then 2 when 'S3' then 3 else 4 end nulls last,
               f.created_at asc`,
    [tenantId]
  );
}

export async function stageCounts(tenantId: string) {
  const rows = await query<{ status: Status; n: string; oldest_hours: string | null }>(
    `select status::text as status, count(*)::text as n,
            max(extract(epoch from now() - coalesce(assigned_at, created_at)) / 3600)::text as oldest_hours
       from office.findings where tenant_id = $1 group by status`,
    [tenantId]
  );
  const m = new Map(rows.map((r) => [r.status, { n: Number(r.n), oldest: r.oldest_hours ? Number(r.oldest_hours) : 0 }]));
  return (s: Status) => m.get(s) ?? { n: 0, oldest: 0 };
}

export type FindingDetail = FindingRow & {
  source: string; source_ref: string | null; fingerprint: string; root_cause: string | null; proposed_fix: string | null;
  money_at_risk_inr: string | null; money_method: string | null; accepted_reason: string | null;
  created_at: string; assigned_at: string | null; fix_reported_at: string | null; closed_at: string | null;
};

export async function getFinding(tenantId: string, ref: string) {
  const rows = await query<FindingDetail>(
    `select f.*, f.area::text as area, f.severity::text as severity, f.status::text as status, f.source::text as source,
            f.scope_counted_at::text as scope_counted_at, f.due_on::text as due_on,
            f.created_at::text as created_at, f.assigned_at::text as assigned_at,
            f.fix_reported_at::text as fix_reported_at, f.closed_at::text as closed_at,
            o.name as owner_name,
            extract(epoch from now() - coalesce(f.assigned_at, f.created_at)) / 3600 as age_hours
       from office.findings f left join office.owners o on o.id = f.owner_id
      where f.tenant_id = $1 and f.ref = $2`,
    [tenantId, ref]
  );
  return rows[0] ?? null;
}

export type EvidenceRow = { id: string; kind: string; body: string | null; url: string | null; source: string; read_at: string };
export async function listEvidence(findingId: string) {
  return query<EvidenceRow>(
    `select id, kind, body, url, source, read_at::text as read_at from office.evidence where finding_id = $1 order by created_at`,
    [findingId]
  );
}

export type AuditRow = { actor: string; event: string; before: unknown; after: unknown; at: string };
export async function listAudit(findingId: string) {
  return query<AuditRow>(
    `select actor, event, before, after, at::text as at from office.audit_log where record_id = $1 order by id`,
    [findingId]
  );
}

export function age(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST";
}
