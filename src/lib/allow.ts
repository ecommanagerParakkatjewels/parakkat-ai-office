// Who may use this deployment. Checked on every request, not just at sign-in,
// so an account created by mistake in Supabase still cannot get in.
// Fails closed: if ALLOWED_EMAILS is empty or missing, nobody is allowed.
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.trim().toLowerCase());
}
