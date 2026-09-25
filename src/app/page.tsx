import { BrainCircuit, History, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");

  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Primary navigation">
        <span className="landing-brand">
          <OsirusMark />
          Osirus
        </span>
        <Link className="btn btn-ghost" href="/auth/sign-in">
          Sign in
        </Link>
      </nav>
      <section className="landing-hero">
        <h1>An agent that finishes the work, and shows it.</h1>
        <p className="landing-copy">
          Osirus plans a task, works in an isolated sandbox, asks before it acts
          on anything you connected, and checks its own result before it calls
          it done.
        </p>
        <div className="landing-actions">
          <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
            Create account
          </Link>
          <Link className="btn btn-secondary btn-lg" href="/auth/sign-in">
            Sign in
          </Link>
        </div>
      </section>
      <section className="landing-principles" aria-label="How Osirus works">
        <article>
          <h2>
            <History size={17} aria-hidden="true" />
            Durable runs
          </h2>
          <p>Runs, steps and checkpoints survive reloads and restarts.</p>
        </article>
        <article>
          <h2>
            <ShieldCheck size={17} aria-hidden="true" />
            You approve what matters
          </h2>
          <p>Pushes, pull requests and external actions wait for your yes.</p>
        </article>
        <article>
          <h2>
            <BrainCircuit size={17} aria-hidden="true" />
            Verified results
          </h2>
          <p>Every answer is checked against evidence before it is final.</p>
        </article>
      </section>
      <footer className="landing-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
