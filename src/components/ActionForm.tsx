"use client";
// A form bound to one server action. Shows the database's refusal in place
// instead of a generic error, keeps what was typed when refused, and
// refreshes the page on success.
import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/findings";

type Props = {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submit: string;
  variant?: "primary" | "danger" | "default";
  confirm?: string;
  style?: React.CSSProperties;
};

export function ActionForm({ action, children, submit, variant = "default", confirm, style }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const cls = variant === "primary" ? "pj-btn pj-btn--primary" : variant === "danger" ? "pj-btn pj-btn--danger" : "pj-btn";
  return (
    // Submitting via a transition rather than the form's action prop stops
    // React 19 from resetting the fields after the submit, so a refused
    // triage keeps its text. `action` stays as the no-JavaScript fallback.
    <form action={formAction} style={{ display: "grid", gap: 8, ...style }}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}>
      {children}
      {state && !state.ok && (
        <p role="alert" style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "var(--critical-tint)", color: "var(--critical)", fontSize: 13, lineHeight: "18px" }}>
          {state.error}
        </p>
      )}
      <button className={cls} type="submit" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Working…" : submit}
      </button>
    </form>
  );
}
