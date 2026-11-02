import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { allowedEmails, isAllowed } from "@/lib/allow";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (allowedEmails().length === 0) redirect("/login?error=config");
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=1");
  if (!isAllowed(email)) {
    await sb.auth.signOut();
    redirect("/login?error=denied");
  }
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--surface-100)" }}>
      <form action={signIn} className="pj-card" style={{ width: "min(400px, 92vw)", padding: 24, display: "grid", gap: 12 }}>
        <div>
          <div className="pj-wordmark" style={{ color: "var(--ink)" }}>Parakkat</div>
          <div className="pj-subtle" style={{ fontSize: 12 }}>AI Office · sign in</div>
        </div>
        {error && (
          <p className="pj-badge pj-badge--critical" style={{ height: "auto", padding: 8, whiteSpace: "normal" }}>
            {error === "denied" ? "This account is not allowed to use this office." :
             error === "config" ? "Sign-in is not configured: ALLOWED_EMAILS is not set on the server." :
             "That email and password did not match."}
          </p>
        )}
        <label className="pj-label" htmlFor="email">Email</label>
        <input className="pj-input" id="email" name="email" type="email" autoComplete="username" required />
        <label className="pj-label" htmlFor="password">Password</label>
        <input className="pj-input" id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="pj-btn pj-btn--primary" type="submit" style={{ justifyContent: "center" }}>Sign in</button>
        <p className="pj-src" style={{ margin: 0 }}>Accounts are created in the Supabase dashboard. There is no self sign-up.</p>
      </form>
    </main>
  );
}
