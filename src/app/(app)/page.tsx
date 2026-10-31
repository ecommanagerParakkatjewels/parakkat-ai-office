import Link from "next/link";
import { currentTenant } from "@/lib/tenant";
import { AREA_LABEL, STATUS_LABEL, age, listFindings, nextAction, stageCounts, type Status } from "@/lib/findings";

const TABS = [
  ["needs_you", "Needs you"], ["open", "All open"], ["waiting", "Waiting on owner"], ["recurred", "Recurred"], ["closed", "Closed"],
] as const;
type Tab = (typeof TABS)[number][0];

const STAGES: { s: Status; label: string }[] = [
  { s: "new", label: "New" }, { s: "triaged", label: "Triaged" }, { s: "assigned", label: "Assigned" },
  { s: "fix_reported", label: "Fix reported" }, { s: "verifying", label: "Verifying" }, { s: "closed", label: "Closed" },
];

const SEV: Record<string, string> = { S1: "pj-badge--critical", S2: "pj-badge--high", S3: "pj-badge--medium", S4: "pj-badge--info" };
const STAT: Record<Status, string> = {
  new: "", triaged: "pj-badge--outline", assigned: "pj-badge--info", fix_reported: "pj-badge--medium",
  verifying: "pj-badge--info", closed: "pj-badge--verified", accepted: "pj-badge--outline", recurred: "pj-badge--critical",
};

export default async function Inbox({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === raw)?.[0] ?? "needs_you") as Tab;
  const tenant = await currentTenant();
  const [rows, count] = await Promise.all([listFindings(tenant.id, tab), stageCounts(tenant.id)]);
  const recurred = count("recurred").n;
  const jam = STAGES.filter((x) => x.s !== "closed").reduce((a, b) => (count(b.s).n > count(a.s).n ? b : a));

  return (
    <>
      <header className="pj-top">
        <span style={{ flexGrow: 1 }} />
        <span className="pj-hide-md pj-subtle" style={{ fontSize: 12 }}>{tenant.name}</span>
        <Link href="/findings/new" className="pj-btn pj-btn--primary row-act">Add finding</Link>
      </header>

      <main className="pj-page">
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 className="dsp page-h1">Inbox</h1>
          <span className="pj-subtle" style={{ fontSize: 13 }}>What needs you now, worst first.</span>
        </div>

        <section className="pj-card" aria-label="Where the work is" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 className="sec-h" style={{ margin: 0 }}>Where the work is</h2>
            <span className="pj-src">Every finding, by how far it has got. Tap a stage to filter.</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "stretch", flexWrap: "wrap" }}>
            {STAGES.map((st, i) => {
              const c = count(st.s);
              const cls = st.s === "closed" ? "stage stage--done" : c.n > 0 && st.s === jam.s && c.n >= 5 ? "stage stage--jam" : "stage";
              const href = st.s === "closed" ? "/?tab=closed" : st.s === "assigned" ? "/?tab=waiting" : "/?tab=open";
              return (
                <span key={st.s} style={{ display: "contents" }}>
                  {i > 0 && <span className="arrowchar" aria-hidden="true">›</span>}
                  <Link href={href} className={cls}>
                    <span className="stage-n">{c.n}</span>
                    <span className="stage-l">{st.label}</span>
                    <span className="stage-m">{c.n ? `oldest ${age(c.oldest)}` : "none"}</span>
                  </Link>
                </span>
              );
            })}
          </div>
          {recurred > 0 && (
            <p style={{ margin: "12px 0 0", padding: "8px 12px", borderRadius: 6, background: "var(--critical-tint)", color: "var(--critical)", fontSize: 13 }}>
              <strong>{recurred} finding{recurred > 1 ? "s" : ""} came back</strong> after closing, so the prevention rule is marked failed.
            </p>
          )}
        </section>

        <div role="tablist" style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--border)", marginBottom: 16, overflowX: "auto" }}>
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/?tab=${k}`} role="tab" aria-selected={tab === k} className="pj-tab"
              style={tab === k ? { color: "var(--ink)", borderBottomColor: "var(--brand)", textDecoration: "none" } : { textDecoration: "none" }}>
              {label}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="pj-card pj-state">
            <strong>Nothing here.</strong>
            <span>{tab === "needs_you" ? "Nothing is waiting on you. Add a finding to start." : "No findings match this view."}</span>
          </div>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-table">
              <thead>
                <tr>
                  <th scope="col">ID</th><th scope="col">Finding</th><th scope="col">Area</th><th scope="col">Sev</th>
                  <th scope="col">Scope, counted</th><th scope="col">Owner</th><th scope="col">Status</th>
                  <th scope="col" className="pj-num">Age</th><th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const act = nextAction(f.status);
                  return (
                    <tr key={f.id}>
                      <td className="pj-mono">{f.ref}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 240 }}><Link href={`/findings/${f.ref}`}>{f.title}</Link></td>
                      <td>{f.area ? AREA_LABEL[f.area] : <span className="pj-subtle">Not triaged</span>}</td>
                      <td>{f.severity ? <span className={`pj-badge ${SEV[f.severity]}`}>{f.severity}</span> : <span className="pj-subtle">—</span>}</td>
                      <td>{f.scope_count != null ? `${f.scope_count.toLocaleString("en-IN")} ${f.scope_unit ?? ""} · ${f.scope_counted_at}` : <span className="pj-subtle">NOT VERIFIED</span>}</td>
                      <td>{f.owner_name ?? <span className="pj-subtle">Unassigned</span>}</td>
                      <td><span className={`pj-badge ${STAT[f.status]}`}>{STATUS_LABEL[f.status]}{f.status === "recurred" && f.recurrence_count > 1 ? ` ×${f.recurrence_count}` : ""}</span></td>
                      <td className="pj-num">{age(f.age_hours)}</td>
                      <td>
                        <Link href={`/findings/${f.ref}`} className={`pj-btn pj-btn--sm row-act ${act.primary ? "pj-btn--primary" : ""} ${act.danger ? "pj-btn--danger" : ""}`}>
                          {act.label}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pj-table-foot">
              <span>{rows.length} finding{rows.length === 1 ? "" : "s"} · sorted by severity, then age</span>
              <span>Nothing can be closed from this list</span>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
