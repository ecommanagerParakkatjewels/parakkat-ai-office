import Link from "next/link";
import { notFound } from "next/navigation";
import { currentTenant } from "@/lib/tenant";
import { closeReadiness, fmtDate, getFinding, listChecks, listRules, listRuns } from "@/lib/findings";
import { ActionForm } from "@/components/ActionForm";
import { acceptRule, close, createCheck, proposeRule, recordRun, sendBack } from "@/lib/actions/findings";

const inputStyle: React.CSSProperties = { height: "auto", padding: 8 };

export default async function VerifyPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const tenant = await currentTenant();
  const f = await getFinding(tenant.id, ref.toUpperCase());
  if (!f) notFound();
  const [checks, runs, rules, ready] = await Promise.all([listChecks(f.id), listRuns(f.id), listRules(f.id), closeReadiness(f.id)]);

  const canVerify = f.status === "verifying";
  const first = runs[0] ?? null;
  const latest = runs.length ? runs[runs.length - 1] : null;
  const latestAfterFix = canVerify && latest && ready.fix_reported_at && latest.ran_at >= ready.fix_reported_at ? latest : null;
  const canClose = canVerify && ready.clean_after_fix && ready.rule_in_force;

  const whyNot: string[] = [];
  if (!canVerify) whyNot.push(`The finding is ${f.status.replace("_", " ")}, not verifying.`);
  if (!ready.clean_after_fix) whyNot.push("No clean check run has been recorded since the owner reported the fix.");
  if (!ready.rule_in_force) whyNot.push("No prevention rule is in force.");

  return (
    <>
      <header className="pj-top">
        <Link href={`/findings/${f.ref}`} className="pj-btn pj-btn--ghost pj-btn--sm row-act">Back to {f.ref}</Link>
        <span style={{ flexGrow: 1 }} />
      </header>

      <main className="pj-page">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span className="pj-mono pj-muted">{f.ref}</span>
          {f.severity && <span className="pj-badge pj-badge--critical">{f.severity}</span>}
          <span className="pj-badge pj-badge--outline">{f.status.replace("_", " ")}</span>
        </div>
        <h1 style={{ margin: "0 0 4px", font: "600 20px/28px var(--font-sans)", letterSpacing: "-0.01em" }}>Verify: {f.title}</h1>
        <p className="pj-src" style={{ margin: "0 0 20px" }}>
          {ready.fix_reported_at ? <>Fix reported {fmtDate(ready.fix_reported_at)}. </> : null}
          A reported fix is a claim. Closing needs fresh evidence from the same check that found it.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>

            <section className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">The check</h2>
              {checks.length === 0 ? (
                <>
                  <p className="pj-src" style={{ margin: "0 0 12px" }}>No check is saved for this finding yet. Describe the thing that found the defect, so the same thing can be run again.</p>
                  <ActionForm action={createCheck} submit="Save check">
                    <input type="hidden" name="finding_id" value={f.id} />
                    <label className="pj-label" htmlFor="name">Short name</label>
                    <input className="pj-input pj-mono" id="name" name="name" required minLength={3} placeholder="warranty-wording-live" />
                    <label className="pj-label" htmlFor="description">What it counts, and where</label>
                    <textarea className="pj-input" id="description" name="description" required minLength={10} rows={2} style={inputStyle} placeholder="Active products whose page text contains “Lifetime Service Warranty”, via Shopify full-text search" />
                  </ActionForm>
                </>
              ) : checks.map((c) => (
                <dl key={c.id} className="pj-dl">
                  <dt>Check</dt><dd className="pj-mono">{c.name}</dd>
                  <dt>What it counts</dt><dd>{c.description}</dd>
                  <dt>Kind</dt><dd>{c.kind} — you run it and record the result</dd>
                </dl>
              ))}
            </section>

            {checks.length > 0 && (
              <section className="pj-card" style={{ padding: 16 }}>
                <h2 className="sec-h">Record a run</h2>
                <ActionForm action={recordRun} submit="Record run" variant="primary">
                  <input type="hidden" name="check_id" value={checks[0]!.id} />
                  <label className="pj-label" htmlFor="matched_count">How many still match right now</label>
                  <input className="pj-input" id="matched_count" name="matched_count" type="number" min={0} required />
                  <label className="pj-label" htmlFor="sample">Sample of what still matches, one per line (up to 20)</label>
                  <textarea className="pj-input pj-mono" id="sample" name="sample" rows={3} style={inputStyle} />
                  <label className="pj-label" htmlFor="note">Note</label>
                  <input className="pj-input" id="note" name="note" placeholder="Counted via Shopify search, 31 Oct 16:04" />
                  <span className="pj-src">A run with 0 matches is recorded as clean. Anything else is still matching, and Close stays locked.</span>
                </ActionForm>
              </section>
            )}

            {first && (
              <section>
                <h2 className="sec-h">Before and after</h2>
                <div className="pj-diff">
                  <div className="pj-diff__col">
                    <div className="pj-diff__lab">First run <span className="pj-badge pj-badge--outline">{fmtDate(first.ran_at)}</span></div>
                    <div className="pj-diff__val"><del>{first.matched_count.toLocaleString("en-IN")}</del> matched</div>
                  </div>
                  <div className="pj-diff__col">
                    <div className="pj-diff__lab">Latest run <span className="pj-badge pj-badge--outline">{fmtDate(latest!.ran_at)}</span></div>
                    <div className="pj-diff__val">{latest!.matched_count === 0 ? <ins>0</ins> : <strong style={{ color: "var(--critical)" }}>{latest!.matched_count.toLocaleString("en-IN")}</strong>} matched</div>
                  </div>
                </div>
                {latestAfterFix ? (
                  latestAfterFix.result === "clean" ? (
                    <div className="pj-card" style={{ padding: 16, marginTop: 12, borderColor: "var(--verified)" }}>
                      <strong style={{ color: "var(--verified)" }}>Verification passed</strong>
                      <p className="pj-src" style={{ margin: "4px 0 0" }}>The check matched nothing after the fix was reported. Computed from the run record, not from a model.</p>
                    </div>
                  ) : (
                    <div className="pj-card" style={{ padding: 16, marginTop: 12, borderColor: "var(--critical)" }}>
                      <strong style={{ color: "var(--critical)" }}>Verification failed — the defect is still live</strong>
                      <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "20px" }}>
                        The check still matches <strong>{latestAfterFix.matched_count.toLocaleString("en-IN")}</strong> after the fix was reported.
                        {latestAfterFix.sample.length > 0 && <> Sample: <span className="pj-mono">{latestAfterFix.sample.slice(0, 5).join(", ")}</span></>}
                      </p>
                    </div>
                  )
                ) : (
                  <p className="pj-src" style={{ margin: "12px 0 0" }}>{canVerify ? "No run yet since the fix was reported. The runs above are from before it, so they do not count toward closing." : "Earlier runs, kept for the record. They do not count toward closing; a fresh run is needed once the finding is back in verification."}</p>
                )}
                <details style={{ marginTop: 8 }}>
                  <summary className="pj-src" style={{ cursor: "pointer" }}>All {runs.length} run{runs.length === 1 ? "" : "s"}</summary>
                  <table className="pj-table pj-table--compact" style={{ marginTop: 8 }}>
                    <thead><tr><th>When</th><th className="pj-num">Matched</th><th>Result</th><th>By</th><th>Note</th></tr></thead>
                    <tbody>{runs.map((r) => (
                      <tr key={r.id}><td>{fmtDate(r.ran_at)}</td><td className="pj-num">{r.matched_count}</td><td>{r.result.replace("_", " ")}</td><td>{r.run_by}</td><td style={{ whiteSpace: "normal" }}>{r.note}</td></tr>
                    ))}</tbody>
                  </table>
                </details>
              </section>
            )}

            <section className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">Prevention rule</h2>
              <p className="pj-src" style={{ margin: "0 0 12px" }}>Required before this can ever close. Without one, the same defect returns and nobody can say why.</p>
              {rules.map((r) => (
                <div key={r.id} className={r.status === "in_force" ? "pj-fact" : "pj-hypo"} style={{ marginBottom: 12 }}>
                  <div className="pj-claim__lab">
                    <span className={`pj-badge ${r.status === "in_force" ? "pj-badge--verified" : r.status === "failed" ? "pj-badge--critical" : "pj-badge--hypothesis"}`}>
                      {r.status === "in_force" ? "In force" : r.status === "failed" ? "Failed" : "Proposed"}
                    </span>
                    <span className="pj-src">by {r.proposed_by}</span>
                  </div>
                  <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: "20px" }}>{r.rule}</p>
                  {r.status === "proposed" && (
                    <ActionForm action={acceptRule} submit="Accept this rule" style={{ maxWidth: 240 }}>
                      <input type="hidden" name="rule_id" value={r.id} />
                    </ActionForm>
                  )}
                </div>
              ))}
              {!rules.some((r) => r.status === "in_force") && (
                <ActionForm action={proposeRule} submit="Propose rule">
                  <input type="hidden" name="finding_id" value={f.id} />
                  <textarea className="pj-input" name="rule" required minLength={10} rows={2} style={inputStyle}
                    placeholder="The change that stops it recurring — a validation, a template, a publish-time check" />
                </ActionForm>
              )}
            </section>
          </div>

          <aside style={{ flex: "1 1 320px", minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">What you can do</h2>
              <div style={{ display: "grid", gap: 8 }}>
                {canClose ? (
                  <ActionForm action={close} submit="Close finding" variant="primary" confirm="Close this finding? Re-checks will be scheduled at 7, 30 and 90 days.">
                    <input type="hidden" name="id" value={f.id} />
                  </ActionForm>
                ) : (
                  <>
                    <button className="pj-btn pj-btn--primary" type="button" disabled style={{ justifyContent: "center" }} title={whyNot.join(" ")}>Close finding</button>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: "18px", color: "var(--critical)" }}>
                      {whyNot.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </>
                )}
                {canVerify && (
                  <ActionForm action={sendBack} submit="Send back to owner" variant="danger" confirm="Send this back? The owner will need to report the fix again.">
                    <input type="hidden" name="id" value={f.id} />
                  </ActionForm>
                )}
                <p className="pj-src" style={{ margin: "4px 0 0" }}>Close is the only control in this system that can set a finding to closed. The list above is exactly what the database checks; the button enables only when every line clears.</p>
              </div>
            </div>

            <div className="pj-card" style={{ padding: 16 }}>
              <h2 className="sec-h">On closure</h2>
              <p className="pj-src" style={{ margin: 0 }}>Re-checks at 7, 30 and 90 days arrive on Day 6. Until then, run the check by hand and use “It came back — reopen” on the finding if it matches again.</p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
