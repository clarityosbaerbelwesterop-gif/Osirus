import { BrainCircuit, History, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Osirus — an agent that finishes the work, and shows it",
  description:
    "Osirus plans a task, works in an isolated sandbox, asks before it acts on anything you connected, and verifies its own result before it calls it done.",
  alternates: { canonical: "/" },
};

const RUN_LINES = [
  { tag: "plan", text: "4 stages drafted, budgeted" },
  { tag: "sandbox", text: "12 steps executed, isolated" },
  { tag: "approval", text: "git push — waiting for your yes" },
  { tag: "verify", text: "result checked against evidence" },
] as const;

const STEPS = [
  "Describe the objective in plain language. Osirus drafts a plan with stages and budgets.",
  "Work happens in an isolated sandbox with deny-all networking by default.",
  "Anything that touches your connected systems waits for your explicit approval.",
  "Every result carries a verification status — verified, unverified, conflicted, rejected.",
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Osirus",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  url: "https://osirus.vercel.app/",
  description:
    "An agent workspace that plans, acts with approval, and verifies its work.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
};

export default async function HomePage() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");

  return (
    <main className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
        <div className="landing-hero-grid">
          <div>
            <p className="landing-eyebrow">
              <span className="landing-dot" aria-hidden="true" />
              Agent workspace
            </p>
            <h1>
              An agent that{" "}
              <span className="landing-emphasis">finishes the work</span>, and
              shows it.
            </h1>
            <p className="landing-copy">
              Osirus plans a task, works in an isolated sandbox, asks before it
              acts on anything you connected, and checks its own result before
              it calls it done.
            </p>
            <div className="landing-actions">
              <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
                Create account
              </Link>
              <Link className="btn btn-secondary btn-lg" href="/auth/sign-in">
                Sign in
              </Link>
            </div>
            <ul className="landing-trust">
              <li>EU-hosted database</li>
              <li>Approval-gated actions</li>
              <li>No payment required</li>
            </ul>
          </div>

          <div
            className="landing-run"
            role="img"
            aria-label="Illustration of an Osirus run: plan, sandbox execution, approval gate, verification — finished with status verified."
          >
            <div className="landing-run-bar">run · audit this repository</div>
            <div className="landing-run-body">
              <span className="landing-run-cmd">$ osirus run</span>
              {RUN_LINES.map((line, i) => (
                <span className="landing-run-line" key={line.tag}>
                  <span className="landing-run-dot" aria-hidden="true" />
                  <span className="landing-run-tag">{line.tag}</span>
                  <span>{line.text}</span>
                </span>
              ))}
              <span className="landing-run-verdict">✓ verified</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-principles" aria-label="How Osirus works">
        <article className="landing-reveal">
          <h2>
            <History size={17} aria-hidden="true" />
            Durable runs
          </h2>
          <p>Runs, steps and checkpoints survive reloads and restarts.</p>
        </article>
        <article className="landing-reveal">
          <h2>
            <ShieldCheck size={17} aria-hidden="true" />
            You approve what matters
          </h2>
          <p>Pushes, pull requests and external actions wait for your yes.</p>
        </article>
        <article className="landing-reveal">
          <h2>
            <BrainCircuit size={17} aria-hidden="true" />
            Verified results
          </h2>
          <p>Every answer is checked against evidence before it is final.</p>
        </article>
      </section>

      <section className="landing-steps landing-reveal" aria-label="The loop">
        <h2>One loop, four honest steps</h2>
        <ol>
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="landing-cta landing-reveal">
        <div>
          <h2>Give it one real task.</h2>
          <p>Watch it plan, ask, act — and prove what it did.</p>
        </div>
        <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
          Create account
        </Link>
      </section>

      <footer className="landing-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </footer>
    </main>
  );
}
