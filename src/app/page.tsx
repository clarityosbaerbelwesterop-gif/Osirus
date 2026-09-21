import { auth } from "@/lib/auth/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");

  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Primary navigation">
        <span className="brand">OSIRUS</span>
        <Link href="/auth/sign-in">Sign in</Link>
      </nav>
      <section className="landing-hero">
        <p className="eyebrow">AGENT OPERATING SYSTEM</p>
        <h1>Durable execution, not another chat wrapper.</h1>
        <p className="landing-copy">
          Osirus combines a model gateway with durable runtime state, contextual
          memory, progressive skills, verification and human control.
        </p>
        <div className="landing-actions">
          <Link className="landing-primary" href="/auth/sign-up">
            Create account
          </Link>
          <Link className="landing-secondary" href="/auth/sign-in">
            Sign in
          </Link>
        </div>
      </section>
      <section className="landing-principles" aria-label="Product principles">
        <article>
          <strong>Durable runtime</strong>
          <p>Runs, events and checkpoints survive refreshes and restarts.</p>
        </article>
        <article>
          <strong>Scoped memory</strong>
          <p>Useful context is retrieved selectively and tenant-scoped.</p>
        </article>
        <article>
          <strong>Progressive skills</strong>
          <p>Only the small skill set relevant to a stage is activated.</p>
        </article>
      </section>
    </main>
  );
}
