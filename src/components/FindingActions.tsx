import Link from "next/link";
import { ActionForm } from "./ActionForm";
import { acceptRisk, addOwner, assign, reopen, reportFixed, sendBack, startVerifying, triage } from "@/lib/actions/findings";
import { AREA_LABEL, type Status } from "@/lib/findings";

type Owner = { id: string; name: string; kind: string };

const inputStyle: React.CSSProperties = { height: "auto", padding: 8 };

/** The one legal next action for this status, as a form. Nothing else is offered. */
export function FindingActions({ id, findingRef, status, owners }: { id: string; findingRef: string; status: Status; owners: Owner[] }) {
  switch (status) {
    case "new":
      return (
        <ActionForm action={triage} submit="Triage" variant="primary">
          <input type="hidden" name="id" value={id} />
          <label className="pj-label" htmlFor="area">Area</label>
          <select className="pj-input" id="area" name="area" required defaultValue="">
            <option value="" disabled>Choose</option>
            {Object.entries(AREA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="pj-label" htmlFor="severity">Severity</label>
          <select className="pj-input" id="severity" name="severity" required defaultValue="">
            <option value="" disabled>Choose</option>
            <option value="S1">S1 — money, legal or trust risk live now</option>
            <option value="S2">S2 — customer-visible at scale</option>
            <option value="S3">S3 — single defect</option>
            <option value="S4">S4 — polish</option>
          </select>
          <label className="pj-label" htmlFor="root_cause">Root cause — the cause, not the symptom</label>
          <textarea className="pj-input" id="root_cause" name="root_cause" required minLength={10} rows={3} style={inputStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div><label className="pj-label" htmlFor="scope_count">Count</label><input className="pj-input" id="scope_count" name="scope_count" type="number" min={0} /></div>
            <div><label className="pj-label" htmlFor="scope_unit">Unit</label><input className="pj-input" id="scope_unit" name="scope_unit" placeholder="products" /></div>
            <div><label className="pj-label" htmlFor="scope_counted_at">Counted on</label><input className="pj-input" id="scope_counted_at" name="scope_counted_at" type="date" /></div>
          </div>
          <span className="pj-src">A count without its date is refused.</span>
        </ActionForm>
      );

    case "triaged":
    case "recurred":
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <ActionForm action={assign} submit={status === "recurred" ? "Reassign and start the clock" : "Assign and start the clock"} variant="primary">
            <input type="hidden" name="id" value={id} />
            <label className="pj-label" htmlFor="owner_id">Owner — who applies the fix</label>
            <select className="pj-input" id="owner_id" name="owner_id" required defaultValue="">
              <option value="" disabled>{owners.length ? "Choose" : "No owners yet — add one below"}</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <label className="pj-label" htmlFor="proposed_fix">Proposed fix — what they actually have to do</label>
            <textarea className="pj-input" id="proposed_fix" name="proposed_fix" required minLength={5} rows={3} style={inputStyle} />
            <label className="pj-label" htmlFor="due_on">Due</label>
            <input className="pj-input" id="due_on" name="due_on" type="date" />
          </ActionForm>
          <details>
            <summary className="pj-src" style={{ cursor: "pointer" }}>Add an owner</summary>
            <ActionForm action={addOwner} submit="Add owner" style={{ marginTop: 8 }}>
              <label className="pj-label" htmlFor="name">Name</label>
              <input className="pj-input" id="name" name="name" required minLength={2} placeholder="Store team" />
              <select className="pj-input" name="kind" defaultValue="team"><option value="team">Team</option><option value="person">Person</option></select>
            </ActionForm>
          </details>
          {status === "triaged" && <AcceptRisk id={id} />}
        </div>
      );

    case "assigned":
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <ActionForm action={reportFixed} submit="Owner reports it fixed" confirm="Record that the owner says this is fixed? It will not close until verified.">
            <input type="hidden" name="id" value={id} />
            <span className="pj-src">This records a claim. Only verification can close it.</span>
          </ActionForm>
          <AcceptRisk id={id} />
        </div>
      );

    case "fix_reported":
      return (
        <ActionForm action={startVerifying} submit="Start verification" variant="primary">
          <input type="hidden" name="id" value={id} />
          <span className="pj-src">Re-run the check that found it. The verify screen opens next.</span>
        </ActionForm>
      );

    case "verifying":
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <Link href={`/findings/${findingRef}/verify`} className="pj-btn pj-btn--primary row-act" style={{ justifyContent: "center" }}>Open verification</Link>
          <ActionForm action={sendBack} submit="Send back to owner" variant="danger" confirm="Send this back? The owner will need to report the fix again.">
            <input type="hidden" name="id" value={id} />
          </ActionForm>
        </div>
      );

    case "closed":
    case "accepted":
      return (
        <ActionForm action={reopen} submit="It came back — reopen" variant="danger" confirm="Reopen this finding? Its prevention rule will be marked failed.">
          <input type="hidden" name="id" value={id} />
          <span className="pj-src">Use this when a re-check finds the defect again. The prevention rule is marked failed automatically.</span>
        </ActionForm>
      );
  }
}

function AcceptRisk({ id }: { id: string }) {
  return (
    <details>
      <summary className="pj-src" style={{ cursor: "pointer" }}>Accept the risk instead, with a reason</summary>
      <ActionForm action={acceptRisk} submit="Accept the risk" style={{ marginTop: 8 }}>
        <input type="hidden" name="id" value={id} />
        <textarea className="pj-input" name="accepted_reason" required minLength={10} rows={2} style={inputStyle} placeholder="Why we are living with this" />
      </ActionForm>
    </details>
  );
}
