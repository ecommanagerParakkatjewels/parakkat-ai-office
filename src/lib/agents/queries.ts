import "server-only";
import { query } from "../db";

export type AgentRunRow = {
  id: string; agent_id: string; agent_name: string; detector: string; trigger: string; status: string;
  items_scanned: number | null; matched: number | null; outcome: string | null; error: string | null;
  ref: string | null; started_at: string; finished_at: string | null; seconds: number | null;
};

const COLS = `r.id, r.agent_id, a.name as agent_name, r.detector, r.trigger, r.status, r.items_scanned, r.matched, r.outcome, r.error,
  f.ref, r.started_at::text, r.finished_at::text, extract(epoch from (r.finished_at - r.started_at))::int as seconds`;

/** The latest run of each detector. */
export async function latestRuns(tenantId: string) {
  return query<AgentRunRow>(
    `select distinct on (r.detector) ${COLS}
       from office.agent_runs r join office.agents a on a.tenant_id = r.tenant_id and a.id = r.agent_id
       left join office.findings f on f.id = r.finding_id
      where r.tenant_id = $1 order by r.detector, r.started_at desc`, [tenantId]);
}

export async function recentRuns(tenantId: string, limit = 40) {
  return query<AgentRunRow>(
    `select ${COLS}
       from office.agent_runs r join office.agents a on a.tenant_id = r.tenant_id and a.id = r.agent_id
       left join office.findings f on f.id = r.finding_id
      where r.tenant_id = $1 order by r.started_at desc limit $2`, [tenantId, limit]);
}
