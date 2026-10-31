import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { withActor } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";
import { currentUser } from "@/lib/supabase/server";

const Input = z.object({
  title: z.string().trim().min(5).max(200),
  evidence: z.string().trim().min(10).max(20000),
  evidence_source: z.string().trim().min(2).max(200),
  fingerprint: z.string().trim().regex(/^[a-z0-9:._-]{3,200}$/, "lower-case letters, digits, : . _ -"),
});

async function create(formData: FormData) {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/login");
  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/findings/new?error=" + encodeURIComponent(parsed.error.issues.map((i) => i.message).join("; ")));
  const d = parsed.data;
  const tenant = await currentTenant();
  let ref = "";
  try {
    ref = await withActor(user.email ?? user.id, async (c) => {
      const r = await c.query(
        `insert into office.findings (tenant_id, title, source, fingerprint) values ($1, $2, 'manual', $3) returning id, ref`,
        [tenant.id, d.title, d.fingerprint]
      );
      await c.query(
        `insert into office.evidence (tenant_id, finding_id, kind, body, source, read_at) values ($1, $2, 'text', $3, $4, now())`,
        [tenant.id, r.rows[0].id, d.evidence, d.evidence_source]
      );
      return r.rows[0].ref as string;
    });
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("duplicate key") ? "A finding with that identity already exists in this brand." : "Could not save the finding.";
    redirect("/findings/new?error=" + encodeURIComponent(msg));
  }
  redirect(`/findings/${ref}`);
}

export default async function NewFinding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <header className="pj-top">
        <Link href="/" className="pj-btn pj-btn--ghost pj-btn--sm row-act">Back to inbox</Link>
        <span style={{ flexGrow: 1 }} />
      </header>
      <main className="pj-page">
        <h1 className="dsp page-h1" style={{ marginBottom: 4 }}>Add finding</h1>
        <p className="pj-src" style={{ margin: "0 0 20px" }}>No evidence, no finding. It starts as <strong>new</strong>; triage comes next.</p>
        <form action={create} className="pj-card" style={{ padding: 20, maxWidth: 720, display: "grid", gap: 12 }}>
          {error && <p className="pj-badge pj-badge--critical" style={{ height: "auto", padding: 8, whiteSpace: "normal" }}>{error}</p>}
          <label className="pj-label" htmlFor="title">What is wrong, in one line</label>
          <input className="pj-input" id="title" name="title" required minLength={5} maxLength={200} placeholder="e.g. Compare-at price set to exactly 2× the selling price" />
          <label className="pj-label" htmlFor="fingerprint">Identity of this defect class</label>
          <input className="pj-input pj-mono" id="fingerprint" name="fingerprint" required pattern="[a-z0-9:._-]{3,200}" placeholder="pricing:compare-at-2x:all-products" />
          <span className="pj-src">Same identity = same finding. A repeat scan updates the count instead of filing again.</span>
          <label className="pj-label" htmlFor="evidence">Evidence — what proves it</label>
          <textarea className="pj-input" id="evidence" name="evidence" required minLength={10} rows={6} style={{ height: "auto", padding: 10 }}
            placeholder="Paste the query, the URLs, the product ids, the count and the date you counted." />
          <label className="pj-label" htmlFor="evidence_source">Where the evidence came from</label>
          <input className="pj-input" id="evidence_source" name="evidence_source" required placeholder="Shopify product export, 13 Oct 2026" />
          <button className="pj-btn pj-btn--primary" type="submit" style={{ justifySelf: "start" }}>Create finding</button>
        </form>
      </main>
    </>
  );
}
