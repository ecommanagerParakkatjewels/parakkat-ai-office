// Proves the rules the database enforces, against a real Postgres.
// Run: TEST_DATABASE_URL=postgres://... npm test
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const db = new Client({ connectionString: url });

let tenant: string;
let owner: string;

async function expectError(sql: string, params: unknown[], fragment: string) {
  await expect(db.query(sql, params)).rejects.toThrow(fragment);
}

async function newFinding(fp: string) {
  const r = await db.query(
    `insert into office.findings (tenant_id, title, source, fingerprint)
     values ($1, $2, 'manual', $3) returning id, ref, status`,
    [tenant, "Test finding " + fp, fp]
  );
  return r.rows[0] as { id: string; ref: string; status: string };
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra);
  const sets = ["status = $2", ...cols.map((c, i) => `${c} = $${i + 3}`)].join(", ");
  await db.query(`update office.findings set ${sets} where id = $1`, [id, status, ...cols.map((c) => extra[c])]);
}

beforeAll(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  await db.connect();
  await db.query("select set_config('app.actor', 'test-suite', false)");
  const t = await db.query(`select id from office.tenants where slug = 'jewels'`);
  tenant = t.rows[0].id;
  const o = await db.query(
    `insert into office.owners (tenant_id, name) values ($1, 'Store team')
     on conflict (tenant_id, name) do update set name = excluded.name returning id`,
    [tenant]
  );
  owner = o.rows[0].id;
});

afterAll(async () => {
  await db.end();
});

describe("finding identity", () => {
  it("gets a sequential ref F-0001 style", async () => {
    const f = await newFinding("fp-ref-" + Date.now());
    expect(f.ref).toMatch(/^F-\d{4}$/);
    expect(f.status).toBe("new");
  });

  it("refuses a second finding with the same fingerprint in the same tenant", async () => {
    const fp = "fp-dupe-" + Date.now();
    await newFinding(fp);
    await expectError(
      `insert into office.findings (tenant_id, title, source, fingerprint) values ($1, 'duplicate of same defect', 'detector', $2)`,
      [tenant, fp],
      "duplicate key"
    );
  });

  it("refuses a count without a count date", async () => {
    await expectError(
      `insert into office.findings (tenant_id, title, source, fingerprint, scope_count) values ($1, 'count', 'manual', $2, 617)`,
      [tenant, "fp-count-" + Date.now()],
      "violates check constraint"
    );
  });

  it("refuses money at risk without a method", async () => {
    await expectError(
      `insert into office.findings (tenant_id, title, source, fingerprint, money_at_risk_inr) values ($1, 'money', 'manual', $2, 1000)`,
      [tenant, "fp-money-" + Date.now()],
      "violates check constraint"
    );
  });
});

describe("the lifecycle", () => {
  it("cannot skip from new to assigned", async () => {
    const f = await newFinding("fp-skip-" + Date.now());
    await expectError(`update office.findings set status = 'assigned' where id = $1`, [f.id], "illegal transition");
  });

  it("cannot be triaged without a root cause", async () => {
    const f = await newFinding("fp-triage-" + Date.now());
    await expectError(
      `update office.findings set status = 'triaged', area = 'catalogue', severity = 'S2' where id = $1`,
      [f.id],
      "triage needs"
    );
  });

  it("cannot be assigned without an owner", async () => {
    const f = await newFinding("fp-own-" + Date.now());
    await setStatus(f.id, "triaged", { area: "catalogue", severity: "S2", root_cause: "template typed by hand" });
    await expectError(
      `update office.findings set status = 'assigned', proposed_fix = 'fix it' where id = $1`,
      [f.id],
      "assignment needs an owner"
    );
  });

  it("cannot be closed from any state except verifying", async () => {
    const f = await newFinding("fp-close1-" + Date.now());
    await expectError(`update office.findings set status = 'closed' where id = $1`, [f.id], "illegal transition");
  });

  it("cannot be closed on a fix report alone", async () => {
    const f = await newFinding("fp-close2-" + Date.now());
    await setStatus(f.id, "triaged", { area: "pricing_offers", severity: "S2", root_cause: "compare-at set by formula" });
    await setStatus(f.id, "assigned", { owner_id: owner, proposed_fix: "clear compare-at" });
    await setStatus(f.id, "fix_reported");
    await setStatus(f.id, "verifying");
    await expectError(`update office.findings set status = 'closed' where id = $1`, [f.id], "no clean check run");
  });

  it("cannot be closed on a clean check run without a prevention rule", async () => {
    const f = await newFinding("fp-close3-" + Date.now());
    await setStatus(f.id, "triaged", { area: "seo_content", severity: "S2", root_cause: "meta typed by hand" });
    await setStatus(f.id, "assigned", { owner_id: owner, proposed_fix: "rewrite meta" });
    await setStatus(f.id, "fix_reported");
    await setStatus(f.id, "verifying");
    const c = await db.query(
      `insert into office.checks (tenant_id, finding_id, name, description, kind) values ($1, $2, 'meta-check', 'count metas saying plated', 'manual') returning id`,
      [tenant, f.id]
    );
    await db.query(
      `insert into office.check_runs (tenant_id, check_id, matched_count, result, run_by) values ($1, $2, 0, 'clean', 'test')`,
      [tenant, c.rows[0].id]
    );
    await expectError(`update office.findings set status = 'closed' where id = $1`, [f.id], "no prevention rule in force");
  });

  it("closes only with a clean run after the fix report AND a rule in force, then reopens on recurrence and fails the rule", async () => {
    const f = await newFinding("fp-full-" + Date.now());
    await setStatus(f.id, "triaged", { area: "catalogue", severity: "S1", root_cause: "spec template predates the warranty rule" });
    await setStatus(f.id, "assigned", { owner_id: owner, proposed_fix: "bulk template edit" });

    // a clean run BEFORE the fix report must not count
    const c = await db.query(
      `insert into office.checks (tenant_id, finding_id, name, description, kind) values ($1, $2, 'warranty-wording', 'products saying lifetime service warranty', 'query') returning id`,
      [tenant, f.id]
    );
    const check = c.rows[0].id;
    await db.query(
      `insert into office.check_runs (tenant_id, check_id, ran_at, matched_count, result, run_by) values ($1, $2, now() - interval '1 day', 0, 'clean', 'test')`,
      [tenant, check]
    );
    await setStatus(f.id, "fix_reported");
    await setStatus(f.id, "verifying");
    const p = await db.query(
      `insert into office.prevention_rules (tenant_id, finding_id, rule, proposed_by) values ($1, $2, 'warranty cell built from category, never typed', 'claude') returning id`,
      [tenant, f.id]
    );
    await db.query(`update office.prevention_rules set status = 'in_force', accepted_at = now() where id = $1`, [p.rows[0].id]);
    await expectError(`update office.findings set status = 'closed' where id = $1`, [f.id], "no clean check run recorded after the fix");

    // a clean run AFTER the fix report does count
    await db.query(
      `insert into office.check_runs (tenant_id, check_id, matched_count, result, run_by) values ($1, $2, 0, 'clean', 'test')`,
      [tenant, check]
    );
    await setStatus(f.id, "closed");
    let row = await db.query(`select status, closed_at, recurrence_count from office.findings where id = $1`, [f.id]);
    expect(row.rows[0].status).toBe("closed");
    expect(row.rows[0].closed_at).not.toBeNull();

    // the re-check finds it again
    await setStatus(f.id, "recurred");
    row = await db.query(`select status, closed_at, recurrence_count from office.findings where id = $1`, [f.id]);
    expect(row.rows[0].status).toBe("recurred");
    expect(row.rows[0].closed_at).toBeNull();
    expect(row.rows[0].recurrence_count).toBe(1);
    const rule = await db.query(`select status, failed_at from office.prevention_rules where id = $1`, [p.rows[0].id]);
    expect(rule.rows[0].status).toBe("failed");
    expect(rule.rows[0].failed_at).not.toBeNull();
  });

  it("a check run marked clean cannot carry a non-zero count", async () => {
    const f = await newFinding("fp-clean-" + Date.now());
    const c = await db.query(
      `insert into office.checks (tenant_id, finding_id, name, description, kind) values ($1, $2, 'x', 'x', 'manual') returning id`,
      [tenant, f.id]
    );
    await expectError(
      `insert into office.check_runs (tenant_id, check_id, matched_count, result, run_by) values ($1, $2, 4, 'clean', 'test')`,
      [tenant, c.rows[0].id],
      "violates check constraint"
    );
  });
});

describe("audit log", () => {
  it("records creation and every status change with the actor", async () => {
    const f = await newFinding("fp-audit-" + Date.now());
    await setStatus(f.id, "triaged", { area: "site_tech", severity: "S3", root_cause: "oversized image" });
    const log = await db.query(`select actor, event, before, after from office.audit_log where record_id = $1 order by id`, [f.id]);
    expect(log.rows.map((r) => r.event)).toEqual(["finding.created", "finding.status"]);
    expect(log.rows[0].actor).toBe("test-suite");
    expect(log.rows[1].before).toEqual({ status: "new" });
    expect(log.rows[1].after).toEqual({ status: "triaged" });
  });

  it("cannot be edited or deleted", async () => {
    await expectError(`update office.audit_log set actor = 'x' where id = (select min(id) from office.audit_log)`, [], "append-only");
    await expectError(`delete from office.audit_log where id = (select min(id) from office.audit_log)`, [], "append-only");
  });
});

describe("tenant isolation", () => {
  it("refuses an owner from another tenant", async () => {
    const t2 = await db.query(`insert into office.tenants (slug, name) values ('t2-' || floor(random()*1e6)::int, 'Other') returning id`);
    const other = t2.rows[0].id;
    const o2 = await db.query(`insert into office.owners (tenant_id, name) values ($1, 'Their team') returning id`, [other]);
    const f = await newFinding("fp-tenant-" + Date.now());
    await setStatus(f.id, "triaged", { area: "catalogue", severity: "S2", root_cause: "x" });
    await expectError(
      `update office.findings set status = 'assigned', owner_id = $2, proposed_fix = 'y' where id = $1`,
      [f.id, o2.rows[0].id],
      "violates foreign key"
    );
  });

  it("refuses two agents on the same seat", async () => {
    await expectError(
      `insert into office.agents (tenant_id, id, name, zone, seat_x, seat_y) values ($1, 'extra', 'Extra', 'review', 2.0, 1.5)`,
      [tenant],
      "duplicate key"
    );
  });
});
