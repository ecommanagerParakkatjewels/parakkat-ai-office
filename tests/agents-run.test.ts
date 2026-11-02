// The agent runner against a real Postgres, with the Shopify read replaced by fixtures.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Client } from "pg";
import type { Product } from "../src/lib/shopify/catalogue";

let products: Product[] = [];
vi.mock("../src/lib/shopify/catalogue", () => ({
  readCatalogue: async () => ({ products, readAt: new Date().toISOString(), bulkOperationId: "gid://shopify/BulkOperation/1" }),
}));

const url = process.env.TEST_DATABASE_URL!;
process.env.DATABASE_URL = url;
const { runAgents } = await import("../src/lib/agents/run");
const db = new Client({ connectionString: url });
let tenant: string;

const P = (handle: string, o: Partial<Product> = {}): Product => ({
  id: "gid://shopify/Product/" + handle, handle, title: handle, status: "ACTIVE", tags: [], description: "",
  seo: { title: null, description: "ok" }, featuredMedia: { id: "m" }, variants: [{ id: "v", sku: handle, price: "100", compareAtPrice: null }], ...o,
});
const FP = "pricing:compare-at-exactly-2x:active-variants";
const finding = async () => (await db.query(`select id, ref, status, source, area, scope_count, scope_unit from office.findings where tenant_id = $1 and fingerprint = $2`, [tenant, FP])).rows[0];
const runs = async (id: string) => (await db.query(`select r.matched_count, r.result, r.run_by from office.check_runs r join office.checks c on c.id = r.check_id where c.finding_id = $1 order by r.ran_at`, [id])).rows;

beforeAll(async () => {
  await db.connect();
  await db.query("select set_config('app.actor', 'test-suite', false)");
  tenant = (await db.query(`select id from office.tenants where slug = 'jewels'`)).rows[0].id;
  // start clean: this file owns the compare-at fingerprint in the test database
  await db.query(`update office.agent_runs set status = 'failed', error = 'test reset', finished_at = now() where status = 'running'`);
  const old = (await db.query(`select id from office.findings where tenant_id = $1 and fingerprint = $2`, [tenant, FP])).rows;
  for (const o of old) {
    await db.query(`delete from office.agent_runs where finding_id = $1`, [o.id]);
    await db.query(`delete from office.findings where id = $1`, [o.id]);
  }
});

describe("agent runner", () => {
  it("files one finding per defect class with evidence, a saved check and a run", async () => {
    products = [P("a", { variants: [{ id: "1", sku: "A1", price: "100", compareAtPrice: "200" }, { id: "2", sku: "A2", price: "50", compareAtPrice: "100" }] }), P("b")];
    const r = await runAgents(tenant, "manual", "tester");
    expect(r.started).toBe(true);
    const pr = r.results.find((x) => x.detector === "compare_at_exactly_2x")!;
    expect(pr).toMatchObject({ status: "ok", matched: 2, scanned: 3, outcome: "filed" });
    const f = await finding();
    expect(f).toMatchObject({ status: "new", source: "detector", area: "pricing_offers", scope_count: 2, scope_unit: "variants" });
    expect(await runs(f.id)).toEqual([{ matched_count: 2, result: "still_matching", run_by: "agent:pricing_offers" }]);
    const ev = (await db.query(`select body from office.evidence where finding_id = $1`, [f.id])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].body).toContain("2 of 3 variants match");
    const audit = (await db.query(`select actor from office.audit_log where record_id = $1`, [f.id])).rows;
    expect(audit[0].actor).toBe("agent:pricing_offers");
  });

  it("a second run updates the same finding instead of filing a duplicate", async () => {
    products = [P("a", { variants: [{ id: "1", sku: "A1", price: "100", compareAtPrice: "200" }] })];
    const r = await runAgents(tenant, "schedule", "schedule");
    expect(r.results.find((x) => x.detector === "compare_at_exactly_2x")!.outcome).toBe("updated");
    const n = (await db.query(`select count(*)::int n from office.findings where tenant_id = $1 and fingerprint = $2`, [tenant, FP])).rows[0].n;
    expect(n).toBe(1);
    expect((await finding()).scope_count).toBe(1);
    const ev = (await db.query(`select body from office.evidence where finding_id = $1 order by created_at`, [(await finding()).id])).rows;
    expect(ev).toHaveLength(2);
    expect(ev[1].body).toContain("Count changed from 2 to 1 of 1 variants");
  });

  it("agents cannot close: a clean run is recorded, the human closes; then a recurrence reopens and fails the rule", async () => {
    const f = await finding();
    const o = (await db.query(`insert into office.owners (tenant_id, name) values ($1, 'Store team') on conflict (tenant_id, name) do update set name = excluded.name returning id`, [tenant])).rows[0].id;
    await db.query(`update office.findings set status='triaged', severity='S2', root_cause='formula at import' where id=$1`, [f.id]);
    await db.query(`update office.findings set status='assigned', owner_id=$2, proposed_fix='bulk edit' where id=$1`, [f.id, o]);
    await db.query(`update office.findings set status='fix_reported' where id=$1`, [f.id]);
    await db.query(`update office.findings set status='verifying' where id=$1`, [f.id]);

    products = [P("a")];
    const r = await runAgents(tenant, "manual", "tester");
    expect(r.results.find((x) => x.detector === "compare_at_exactly_2x")!.outcome).toBe("clean");
    expect((await finding()).status).toBe("verifying"); // the agent did not close it

    await db.query(`insert into office.prevention_rules (tenant_id, finding_id, rule, proposed_by, status, accepted_at) values ($1,$2,'compare-at never set by formula','human','in_force',now())`, [tenant, f.id]);
    await db.query(`update office.findings set status='closed' where id=$1`, [f.id]); // the agent's clean run satisfies the close rule
    expect((await finding()).status).toBe("closed");

    products = [P("a", { variants: [{ id: "1", sku: "A1", price: "10", compareAtPrice: "20" }] })];
    const back = await runAgents(tenant, "schedule", "schedule");
    expect(back.results.find((x) => x.detector === "compare_at_exactly_2x")!.outcome).toBe("reopened");
    expect((await finding()).status).toBe("recurred");
    const rule = (await db.query(`select status from office.prevention_rules where finding_id = $1`, [f.id])).rows[0];
    expect(rule.status).toBe("failed");
  });

  it("an accepted risk is not reopened just because it still matches", async () => {
    const f = await finding();
    await db.query(`update office.findings set status='accepted', accepted_reason='living with it for now' where id=$1`, [f.id]);
    const r = await runAgents(tenant, "manual", "tester");
    expect(r.results.find((x) => x.detector === "compare_at_exactly_2x")!.outcome).toBe("updated");
    expect((await finding()).status).toBe("accepted");
  });

  it("refuses to overlap a run that is still going", async () => {
    await db.query(`insert into office.agent_runs (tenant_id, agent_id, detector, trigger, source, run_by) values ($1,'catalogue','no_image','manual','shopify','x')`, [tenant]);
    const r = await runAgents(tenant, "manual", "tester");
    expect(r.started).toBe(false);
    await db.query(`update office.agent_runs set status='failed', error='test', finished_at=now() where status='running'`);
  });

  it("a failed Shopify read marks every run failed and files nothing", async () => {
    const mod = await import("../src/lib/shopify/catalogue");
    const spy = vi.spyOn(mod, "readCatalogue").mockRejectedValueOnce(new Error("401 Unauthorized"));
    const r = await runAgents(tenant, "manual", "tester");
    expect(r.results.every((x) => x.status === "failed")).toBe(true);
    spy.mockRestore();
    const failed = (await db.query(`select count(*)::int n from office.agent_runs where error like 'Shopify read failed: 401%'`)).rows[0].n;
    expect(failed).toBeGreaterThanOrEqual(5);
  });
});
