import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Inbox" },
  { href: "/findings", label: "Findings" },
  { href: "/agents", label: "Agents" },
  { href: "/floor", label: "The floor", soon: true },
  { href: "/ledger", label: "Ledger", soon: true },
];

export function Shell({
  current, tenantName, email, openCount, children,
}: { current: string; tenantName: string; email: string; openCount: number; children: ReactNode }) {
  return (
    <div className="pj-shell" style={{ minHeight: "100vh" }}>
      <nav className="pj-side" aria-label="Main">
        <div style={{ padding: "var(--space-4) var(--space-3) var(--space-3)" }}>
          <span className="pj-wordmark">Parakkat<small>AI Office</small></span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 var(--space-2)" }}>
          {NAV.map((n) =>
            n.soon ? (
              <span key={n.href} className="pj-nav" aria-disabled="true" style={{ opacity: 0.45 }} title="Not built yet">
                <span style={{ flexGrow: 1 }}>{n.label}</span>
                <span className="pj-count">soon</span>
              </span>
            ) : (
              <Link key={n.href} href={n.href} className="pj-nav" aria-current={current === n.href ? "page" : undefined}
                style={current === n.href ? { background: "var(--nav-bg-active)", color: "var(--nav-ink)" } : undefined}>
                <span style={{ flexGrow: 1 }}>{n.label}</span>
                {n.href === "/" && openCount > 0 && <span className="pj-count">{openCount}</span>}
              </Link>
            )
          )}
        </div>
        <div style={{ marginTop: "auto", padding: "var(--space-3)", borderTop: "1px solid rgba(255,255,255,.08)", font: "400 12px/16px var(--font-sans)", color: "var(--nav-ink-muted)" }}>
          {tenantName}
          {email && <div title={email} style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div>}
          <form action="/auth/signout" method="post" style={{ marginTop: 8 }}>
            <button className="pj-btn pj-btn--sm" type="submit" style={{ background: "transparent", color: "var(--nav-ink)", borderColor: "var(--nav-ink-muted)" }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <div className="pj-main">
        {/* Phones: the sidebar is hidden below 768px, so the same links live in this bar. */}
        <nav className="m-bar" aria-label="Main">
          <span className="pj-wordmark m-wm">Parakkat</span>
          {NAV.filter((n) => !n.soon).map((n) => (
            <Link key={n.href} href={n.href} className="m-link" aria-current={current === n.href ? "page" : undefined}>
              {n.label}{n.href === "/" && openCount > 0 && <span className="m-count">{openCount}</span>}
            </Link>
          ))}
          <details className="m-more">
            <summary aria-label="More">More</summary>
            <div className="m-menu">
              {NAV.filter((n) => n.soon).map((n) => <span key={n.href} className="pj-subtle">{n.label} · soon</span>)}
              <span className="pj-subtle">{tenantName}</span>
              <form action="/auth/signout" method="post">
                <button className="pj-btn pj-btn--sm" type="submit">Sign out{email ? ` (${email})` : ""}</button>
              </form>
            </div>
          </details>
        </nav>
        {children}
      </div>
    </div>
  );
}
