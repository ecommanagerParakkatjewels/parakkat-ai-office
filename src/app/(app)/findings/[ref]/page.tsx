import Link from "next/link";
import { notFound } from "next/navigation";
import { currentTenant } from "@/lib/tenant";
import { AREA_LABEL, STATUS_LABEL, age, fmtDate, getFinding, listAudit, listEvidence, listOwners, listRules, nextAction } from "@/lib/findings";
import { FindingActions } from "@/components/FindingActions";

const SEV: Record<string, string> = { S1: "pj-badge--critical", S2: "pj-badge--high", S3: "pj-badge--medium", S4: "pj-badge--info" };

function Gap({ label = "NOT PROVIDED" }: { label?: string }) {
  return <span className="pj-subtle">{label}</span>;
}

export default async function FindingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const tenant = await currentTenant();
  const f = await getFinding(tenant.id, ref.toUpperCase());
  if (!f) notFound();
  const [evidence, audit, owners, rules] = await Promise.all([listEvidence(f.id), listAudit(f.id), listOwners(tenant.id), listRules(f.id)]);
  const act = nextAction(f.status);

  const legal: Record<string, string> = {
    new: "Triage it: set area, severity and a root cause.",
    triaged: "Assign it to a named owner with a proposed fix. The clock starts then.",
    assigned: "Chase the owner. Only they can report it fixed.",
    fix_reported: "Verify: re-run the check that found it. A reported fix is a claim.",
    verifying: "Finish verification. Close is allowed only on a clean run and a prevention rule in force.",
    closed: "Re-checks are scheduled. If it comes back, it reopens on its own.",
    accepted: "Living with it, with a reason. Still re-checked.",
    recurred: "It came back and its prevention rule failed. Reassign it.",
  };

  return (
    <>
      <header className="pj-top">
        <Link href="/" className="pj-btn pj-btn--ghost pj-btn--sm row-act">Back to inbox</Link>
        <span style={{ flexGrow: 1 }} />
      </header>

      <main className="pj-page">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span className="pj-mono pj-muted">{f.ref}</span>
          {f.severity ? <span className={`pj-badge ${SEV[f.severity]}`}>{f.severity}</span> : null}
          <span className="pj-badge pj-badge--outline">{STATUS_LABEL[f.status]}</span>
          {f.area && <span className="pj-badge">{AREA_LABEL[f.area]}</span>}
        </div>
        <h1 style={{ margin: "0 0 4px", font: "600 20px/28px var(--font-sans)", letterSpacing: "-0.01em" }}>{f.title}</h1>
        <p className="pj-src" style={{ margin: "0 0 20px" }}>{legal[f.status]}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>

            <section className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">Facts</h2>
              <dl className="pj-dl">
                <dt>Area</dt><dd>{f.area ? AREA_LABEL[f.area] : <Gap label="Not triaged" />}</dd>
                <dt>Severity</dt><dd>{f.severity ?? <Gap label="Not triaged" />}</dd>
                <dt>Scope</dt><dd>{f.scope_count != null ? <>{f.scope_count.toLocaleString("en-IN")} {f.scope_unit} <span className="pj-subtle">· counted {f.scope_counted_at}</span></> : <Gap label="NOT VERIFIED" />}</dd>
                <dt>Money at risk</dt><dd>{f.money_at_risk_inr ? <>₹{Number(f.money_at_risk_inr).toLocaleString("en-IN")} <span className="pj-subtle">· {f.money_method}</span></> : <Gap />}</dd>
                <dt>Source</dt><dd>{f.source}{f.source_ref ? <> · <span className="pj-mono">{f.source_ref}</span></> : null}</dd>
                <dt>Identity</dt><dd className="pj-mono">{f.fingerprint}</dd>
                <dt>Raised</dt><dd>{fmtDate(f.created_at)} · {age(f.age_hours)} open</dd>
                <dt>Owner</dt><dd>{f.owner_name ?? <Gap label="Unassigned" />}</dd>
                {f.accepted_reason && <><dt>Accepted because</dt><dd>{f.accepted_reason}</dd></>}
              </dl>
            </section>

            <section className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">Evidence</h2>
              {evidence.length === 0 ? (
                <p className="pj-src" style={{ margin: 0 }}>No evidence attached. A finding with no evidence cannot leave triage.</p>
              ) : evidence.map((e) => (
                <div key={e.id} className="pj-fact" style={{ marginBottom: 12 }}>
                  <div className="pj-claim__lab"><span className="pj-badge pj-badge--outline">{e.kind}</span></div>
                  {e.body && <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: "20px", whiteSpace: "pre-wrap" }}>{e.body}</p>}
                  {e.url && <p style={{ margin: "0 0 8px" }}><a href={e.url} target="_blank" rel="noreferrer" className="pj-mono">{e.url}</a></p>}
                  <p className="pj-src" style={{ margin: 0 }}>Source: {e.source} · read {fmtDate(e.read_at)}</p>
                </div>
              ))}
            </section>

            <section className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">Root cause and fix</h2>
              <dl className="pj-dl" style={{ gridTemplateColumns: "110px 1fr" }}>
                <dt>Root cause</dt><dd>{f.root_cause ?? <Gap label="NOT PROVIDED — required before triage" />}</dd>
                <dt>Proposed fix</dt><dd>{f.proposed_fix ?? <Gap label="NOT PROVIDED — required before assignment" />}</dd>
              </dl>
            </section>
          </div>

          <aside style={{ flex: "1 1 320px", minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">Next action: {act.label}</h2>
              <p className="pj-src" style={{ margin: "0 0 12px" }}>{legal[f.status]}</p>
              <FindingActions id={f.id} findingRef={f.ref} status={f.status} owners={owners} />
              <p className="pj-src" style={{ margin: "12px 0 0" }}>The status decides what is offered. Closing never appears here; it lives on the verify screen alone, and the database refuses it without a clean check run after the fix report and a prevention rule in force.</p>
            </div>

            {rules.length > 0 && (
              <div className="pj-card" style={{ padding: 16 }}>
                <h2 className="sec-h">Prevention rule</h2>
                {rules.map((r) => (
                  <p key={r.id} style={{ margin: "0 0 8px", fontSize: 13, lineHeight: "18px" }}>
                    <span className={`pj-badge ${r.status === "in_force" ? "pj-badge--verified" : r.status === "failed" ? "pj-badge--critical" : "pj-badge--outline"}`}>{r.status.replace("_", " ")}</span>{" "}
                    {r.rule}
                  </p>
                ))}
              </div>
            )}

            <div className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">History</h2>
              {audit.length === 0 ? <p className="pj-src" style={{ margin: 0 }}>Nothing recorded yet.</p> : (
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: "20px", color: "var(--ink-muted)" }}>
                  {audit.map((a, i) => (
                    <li key={i}><span className="pj-mono">{fmtDate(a.at)}</span> — {a.event === "finding.created" ? "created" : `${(a.before as { status?: string })?.status} → ${(a.after as { status?: string })?.status}`} <span className="pj-subtle">by {a.actor}</span></li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
