import Link from "next/link";
export default function NotFound() {
  return (
    <main className="pj-page">
      <div className="pj-card pj-state"><strong>Not found.</strong><span>No finding with that reference in this brand.</span><Link href="/">Back to inbox</Link></div>
    </main>
  );
}
