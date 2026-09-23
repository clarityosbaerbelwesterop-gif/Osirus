import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <section className="status-card">
        <p className="overline">Osirus</p>
        <h1>Page not found</h1>
        <p>The requested route does not exist.</p>
        <Link className="btn btn-secondary" href="/">
          Return home
        </Link>
      </section>
    </main>
  );
}
