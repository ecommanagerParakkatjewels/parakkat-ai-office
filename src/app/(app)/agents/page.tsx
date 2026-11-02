import Link from "next/link";
import { currentTenant } from "@/lib/tenant";
import { DETECTORS } from "@/lib/agents/detectors";
import { latestRuns, recentRuns } from "@/lib/agents/queries";
import { shopifyStatus } from "@/lib/shopify/client";
import { fmtDate, AREA_LABEL } from "@/lib/findings";
import { ActionForm } from "@/components/ActionForm";
import { runAgentsNow } from "@/lib/actions/agents";

export const dynamic = "force-dynamic";
// The run button's server action reads the whole catalogue: allow up to 5 minutes.
export const maxDuration = 300;

const OUTCOME: Record<string, string> = {
  filed: "Filed a new finding", updated: "Updated the count", reopened: "Problem came back — reopened",
  clean: "Clean — nothing matches", nothing_found: "Nothing found",
};

const CONNECT_MSG: Record<string, [string, boolean]> = {
  connected: ["Shopify connected, read-only.", true],
  not_configured: ["The app's Shopify client ID and secret are not set in Vercel.", false],
  bad_signature: ["Refused: the reply did not carry Shopify's signature for this app.", false],
  wrong_store: ["Refused: the reply came from a different store.", false],
  bad_state: ["Refused: the connection request expired or did not start here. Try again.", false],
  no_code: ["Shopify did not send an approval code. Try again.", false],
  exchange_failed: ["Shopify did not issue a token. Check the client ID and secret.", false],
  write_scope_refused: ["Refused and not stored: the app was granted write access. Give it read_products only.", false],
};

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ shopify?: string }> }) {
  const { shopify: msg } = await searchParams;
  const tenant = await currentTenant();
  const status = await shopifyStatus();
  const configured = status.connected;
  const [latest, recent] = await Promise.all([latestRuns(tenant.id), recentRuns(tenant.id)]);
  const byDetector = new Map(latest.map((r) => [r.detector, r]));

  return (
    <>
      <header className="pj-top"><span style={{ flexGrow: 1 }} /></header>
      <main className="pj-page">
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <h1 className="dsp page-h1">Agents</h1>
          <span className="pj-subtle" style={{ fontSize: 13 }}>Read-only checks on the live store. They file and update findings; people triage, assign and close.</span>
        </div>

        {msg && CONNECT_MSG[msg] && (
          <p role="status" style={{ margin: "12px 0 0", padding: "8px 12px", borderRadius: 6, fontSize: 13,
            background: CONNECT_MSG[msg][1] ? "var(--verified-tint)" : "var(--critical-tint)", color: CONNECT_MSG[msg][1] ? "var(--verified)" : "var(--critical)" }}>
            {CONNECT_MSG[msg][0]}
          </p>
        )}
        <section className="pj-card" style={{ padding: 16, margin: "16px 0 0", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 320px" }}>
            <h2 className="sec-h">Shopify connection</h2>
            <p className="pj-src" style={{ margin: 0 }}>
              {status.connected
                ? <>Connected to <span className="pj-mono">{status.account}</span>{status.scopes ? <>, scopes <span className="pj-mono">{status.scopes}</span></> : null}{status.installedAt ? <> · since {fmtDate(status.installedAt)}</> : null}. Read-only: the app refuses any write, whatever the token allows.</>
                : status.configured
                  ? "The app is set up but not yet installed on the store. Connect it once; Shopify will ask you to approve read-only access."
                  : "Not set up: Shopify client ID and secret are NOT PROVIDED in Vercel."}
            </p>
          </div>
          {status.configured && status.via !== "env_token" && (
            <a href="/api/shopify/install" className={`pj-btn row-act ${status.connected ? "" : "pj-btn--primary"}`} style={{ justifyContent: "center", minWidth: 220 }}>
              {status.connected ? "Reconnect Shopify" : "Connect Shopify (read-only)"}
            </a>
          )}
        </section>

        <section className="pj-card" style={{ padding: 16, margin: "16px 0 20px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 320px" }}>
            <h2 className="sec-h">Run all agents now</h2>
            <p className="pj-src" style={{ margin: 0 }}>
              {configured
                ? "Reads the whole Shopify catalogue once (about a minute), then every agent checks it. They also run on their own every morning."
                : "Connect Shopify first. Until then the agents have nothing to read."}
            </p>
          </div>
          {configured && (
            <ActionForm action={runAgentsNow} submit="Run agents now" variant="primary" style={{ minWidth: 220 }}>
              <span className="pj-src">Nothing in Shopify is changed.</span>
            </ActionForm>
          )}
        </section>

        <div className="pj-table-wrap" style={{ marginBottom: 24 }}>
          <table className="pj-table">
            <thead><tr><th>Agent</th><th>Looks for</th><th className="pj-num">Matched</th><th>Last result</th><th>Finding</th><th className="hide-tab">When</th></tr></thead>
            <tbody>
              {DETECTORS.map((d) => {
                const r = byDetector.get(d.id);
                return (
                  <tr key={d.id}>
                    <td>{r?.agent_name ?? d.agentId}<div className="pj-subtle" style={{ fontSize: 12 }}>{AREA_LABEL[d.area]}</div></td>
                    <td style={{ whiteSpace: "normal", minWidth: 220 }}>{d.title}</td>
                    <td className="pj-num">{r?.status === "ok" ? <>{r.matched!.toLocaleString("en-IN")}<span className="pj-subtle"> / {r.items_scanned!.toLocaleString("en-IN")}</span></> : <span className="pj-subtle">NOT VERIFIED</span>}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {!r ? <span className="pj-subtle">Never run</span>
                        : r.status === "running" ? <span className="pj-badge pj-badge--info">Running</span>
                        : r.status === "failed" ? <span style={{ color: "var(--critical)" }}>Failed: {r.error}</span>
                        : OUTCOME[r.outcome ?? ""] ?? r.outcome}
                    </td>
                    <td>{r?.ref ? <Link href={`/findings/${r.ref}`} className="pj-mono">{r.ref}</Link> : <span className="pj-subtle">None</span>}</td>
                    <td className="hide-tab">{r ? fmtDate(r.started_at) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="sec-h">Run history</h2>
        {recent.length === 0 ? <p className="pj-src">No runs yet.</p> : (
          <div className="pj-table-wrap">
            <table className="pj-table pj-table--compact">
              <thead><tr><th>When</th><th>Agent</th><th>Detector</th><th>Trigger</th><th className="pj-num">Matched</th><th>Result</th><th className="pj-num hide-tab">Seconds</th></tr></thead>
              <tbody>{recent.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.started_at)}</td><td>{r.agent_name}</td><td className="pj-mono">{r.detector}</td><td>{r.trigger}</td>
                  <td className="pj-num">{r.matched ?? ""}</td>
                  <td style={{ whiteSpace: "normal" }}>{r.status === "failed" ? <span style={{ color: "var(--critical)" }}>{r.error}</span> : r.status === "running" ? "Running" : OUTCOME[r.outcome ?? ""]}</td>
                  <td className="pj-num hide-tab">{r.seconds ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
