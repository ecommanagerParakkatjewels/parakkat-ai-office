// Runs every detector over one catalogue read and files the results through
// the same lifecycle a human uses. Agents may file, update, record runs and
// reopen a closed finding that came back. They may never triage, assign or
// close: those stay human, and the database enforces closing anyway.
import "server-only";
import type { PoolClient } from "pg";
import { query, withActor } from "../db";
import { readCatalogue, type Catalogue } from "../shopify/catalogue";
import { DETECTORS, type Detector, type Detection } from "./detectors";

export type AgentOutcome = { detector: string; agentId: string; status: "ok" | "failed"; matched?: number; scanned?: number; outcome?: string; ref?: string; error?: string };

const SAMPLE = 20;
const STALE_MINUTES = 10;

export async function runAgents(tenantId: string, trigger: "manual" | "schedule", by: string): Promise<{ started: boolean; reason?: string; results: AgentOutcome[] }> {
  // Close out runs that were killed mid-way, then refuse to overlap a live one.
  await query(
    `update office.agent_runs set status = 'failed', error = 'did not finish (timed out or interrupted)', finished_at = now()
      where tenant_id = $1 and status = 'running' and started_at < now() - ($2 || ' minutes')::interval`,
    [tenantId, String(STALE_MINUTES)],
  );
  const live = await query<{ n: string }>(`select count(*)::text n from office.agent_runs where tenant_id = $1 and status = 'running'`, [tenantId]);
  if (Number(live[0]?.n ?? 0) > 0) return { started: false, reason: "Agents are already running. Try again in a few minutes.", results: [] };

  const runIds = new Map<string, string>();
  for (const d of DETECTORS) {
    const r = await query<{ id: string }>(
      `insert into office.agent_runs (tenant_id, agent_id, detector, trigger, source, run_by) values ($1, $2, $3, $4, 'shopify', $5) returning id`,
      [tenantId, d.agentId, d.id, trigger, by],
    );
    runIds.set(d.id, r[0]!.id);
  }

  let cat: Catalogue;
  try {
    cat = await readCatalogue();
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    for (const id of runIds.values()) await failRun(id, "Shopify read failed: " + msg);
    return { started: true, results: DETECTORS.map((d) => ({ detector: d.id, agentId: d.agentId, status: "failed", error: msg })) };
  }

  const results: AgentOutcome[] = [];
  for (const d of DETECTORS) {
    const runId = runIds.get(d.id)!;
    try {
      const det = d.run(cat.products);
      const { outcome, findingId, ref } = await withActor(`agent:${d.agentId}`, (c) => file(c, tenantId, d, det, cat));
      await query(
        `update office.agent_runs set status = 'ok', finished_at = now(), items_scanned = $2, matched = $3, outcome = $4, finding_id = $5 where id = $1`,
        [runId, det.scanned, det.hits.length, outcome, findingId],
      );
      results.push({ detector: d.id, agentId: d.agentId, status: "ok", matched: det.hits.length, scanned: det.scanned, outcome, ref: ref ?? undefined });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await failRun(runId, msg);
      results.push({ detector: d.id, agentId: d.agentId, status: "failed", error: msg });
    }
  }
  return { started: true, results };
}

async function failRun(id: string, error: string) {
  await query(`update office.agent_runs set status = 'failed', finished_at = now(), error = $2 where id = $1`, [id, error]);
}

type Filed = { outcome: "filed" | "updated" | "reopened" | "clean" | "nothing_found"; findingId: string | null; ref: string | null };

async function file(c: PoolClient, tenantId: string, d: Detector, det: Detection, cat: Catalogue): Promise<Filed> {
  const matched = det.hits.length;
  const sample = det.hits.slice(0, SAMPLE).map((h) => `${h.handle} — ${h.detail}`);
  const source = `Shopify Admin API bulk read ${cat.bulkOperationId.split("/").pop()}, ${cat.readAt}`;

  const existing = await c.query<{ id: string; ref: string; status: string }>(
    `select id, ref, status from office.findings where tenant_id = $1 and fingerprint = $2 for update`,
    [tenantId, d.fingerprint],
  );
  let f = existing.rows[0] ?? null;

  if (!f) {
    if (matched === 0) return { outcome: "nothing_found", findingId: null, ref: null };
    const ins = await c.query<{ id: string; ref: string; status: string }>(
      `insert into office.findings (tenant_id, title, source, source_ref, fingerprint, area, scope_count, scope_unit, scope_counted_at)
       values ($1, $2, 'detector', $3, $4, $5, $6, $7, current_date) returning id, ref, status`,
      [tenantId, d.title, d.id, d.fingerprint, d.area, matched, det.unit],
    );
    f = ins.rows[0]!;
    await c.query(
      `insert into office.evidence (tenant_id, finding_id, kind, body, source, read_at) values ($1, $2, 'record', $3, $4, $5)`,
      [tenantId, f.id, `${matched} of ${det.scanned} ${det.unit} match.\nCheck: ${d.check}\nSample (up to ${SAMPLE}):\n${sample.join("\n")}`, source, cat.readAt],
    );
  }

  // The saved check this detector runs for the finding, created once.
  let check = await c.query<{ id: string }>(
    `select id from office.checks where tenant_id = $1 and finding_id = $2 and kind = 'detector' and definition->>'detector' = $3`,
    [tenantId, f.id, d.id],
  );
  if (!check.rows[0]) {
    check = await c.query<{ id: string }>(
      `insert into office.checks (tenant_id, finding_id, name, description, kind, definition) values ($1, $2, $3, $4, 'detector', $5::jsonb) returning id`,
      [tenantId, f.id, d.id, d.check, JSON.stringify({ detector: d.id, source: "shopify" })],
    );
  }
  await c.query(
    `insert into office.check_runs (tenant_id, check_id, matched_count, sample, result, note, run_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [tenantId, check.rows[0]!.id, matched, JSON.stringify(sample), matched === 0 ? "clean" : "still_matching", source, `agent:${d.agentId}`],
  );

  if (existing.rows.length === 0) return { outcome: "filed", findingId: f.id, ref: f.ref };

  await c.query(`update office.findings set scope_count = $2, scope_unit = $3, scope_counted_at = current_date where id = $1`, [f.id, matched, det.unit]);
  // Only a CLOSED finding reopens. An accepted risk is expected to keep matching.
  if (matched > 0 && f.status === "closed") {
    await c.query(`update office.findings set status = 'recurred' where id = $1`, [f.id]);
    return { outcome: "reopened", findingId: f.id, ref: f.ref };
  }
  return { outcome: matched === 0 ? "clean" : "updated", findingId: f.id, ref: f.ref };
}
