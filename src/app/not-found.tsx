import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <section className="status-card">
        <p className="eyebrow">OSIRUS</p>
        <h1>Page not found</h1>
        <p className="muted">The requested route does not exist.</p>
        <Link href="/">Return home</Link>
      </section>
    </main>
  );
}
