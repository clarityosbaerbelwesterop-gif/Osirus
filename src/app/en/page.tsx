import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AgentStory,
  BotStory,
  WorkStory,
} from "@/components/marketing/stories";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";
import { isFreeTierEnabled, startAccountLabel } from "@/app/free-tier";
import { absoluteUrl } from "@/app/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Osirus — Bots, Work & Agents",
  description:
    "Osirus is a workspace for Assistant, Work, and Agents. Models run via UNOROUTER.",
  alternates: { canonical: "/en" },
};

function faq(freeTier: boolean) {
  return [
    {
      q: "What can I use today?",
      a: "You can create an account and work with the Assistant. External actions wait for your approval. Custom bots, deploy, group chats, and recommendations for model, verifier, and sub-agents are coming soon.",
    },
    {
      q: "Which models are available?",
      a: "Calls run via UNOROUTER. A selectable model list is coming soon. Custom models are not offered.",
    },
    ...(freeTier
      ? [
          {
            q: "Is there a free tier?",
            a: "Yes, a limited free tier. The scope is shown in the app. Specific amounts are not listed here.",
          },
          {
            q: "What happens when the free tier runs out?",
            a: "When the limited free tier is exhausted, you wait for it to refill or choose a plan in the app. Additional credit cannot be purchased.",
          },
        ]
      : [
          {
            q: "Where can I see plans?",
            a: "In the app, under Plan. Prices are shown there and before purchase in checkout.",
          },
        ]),
    {
      q: "Does Osirus verify every answer?",
      a: "No. A model answer alone is not proof. A separate verifier model is coming soon.",
    },
  ];
}

export default async function HomePageEn() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");
  const startLabel = startAccountLabel();
  const freeTier = isFreeTierEnabled();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Osirus",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/en"),
    description:
      "Workspace for Assistant, Work, and Agents. Models via UNOROUTER.",
  };

  return (
    <main className="landing" lang="en">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <nav className="landing-nav" aria-label="Main navigation">
        <span className="landing-brand">
          <OsirusMark />
          Osirus
        </span>
        <div className="landing-nav-links">
          <a href="#bots">Bots</a>
          <a href="#work">Work</a>
          <a href="#agents">Agents</a>
          <Link className="btn btn-ghost" href="/auth/sign-in">
            Sign in
          </Link>
          <Link className="btn btn-ghost" href="/">
            DE
          </Link>
        </div>
      </nav>

      <div id="content">
        <section className="landing-hero">
          <p className="landing-eyebrow">
            <span className="landing-dot" aria-hidden="true" />
            Workspace
          </p>
          <h1>
            Bots, Work & <span className="landing-emphasis">Agents</span>
          </h1>
          <p className="landing-copy">
            Osirus is the workspace for an assistant, for larger tasks,
            and for your own agents. Models run via UNOROUTER. External actions
            wait for your approval.
          </p>
          <div className="landing-actions">
            <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
              {startLabel}
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/auth/sign-in">
              Sign in
            </Link>
          </div>
        </section>

        <section
          id="bots"
          className="landing-block"
          aria-labelledby="bots-title"
        >
          <div>
            <h2 id="bots-title">Bots</h2>
            <p>
              A conversation with the Assistant is available today. Creating
              custom bots, choosing a model per bot, deploying them, and bringing
              them together in a group chat is coming soon.
            </p>
            <Link className="btn btn-secondary" href="/auth/sign-up">
              {startLabel}
            </Link>
          </div>
          <BotStory />
        </section>

        <section
          id="work"
          className="landing-block"
          aria-labelledby="work-title"
        >
          <div>
            <h2 id="work-title">Work</h2>
            <p>
              First comes the task. Then the model, verifier model, and number
              of sub-agents should appear, each with a &ldquo;Recommended&rdquo; hint. This
              selection is coming soon. You can override the suggestions later.
            </p>
          </div>
          <WorkStory />
        </section>

        <section
          id="agents"
          className="landing-block"
          aria-labelledby="agents-title"
        >
          <div>
            <h2 id="agents-title">Agents</h2>
            <p>
              Agents are persistent roles. Creating, deploying, and group chat
              are coming soon.
            </p>
          </div>
          <AgentStory />
        </section>

        <section
          id="verification"
          className="landing-block landing-block-single"
          aria-labelledby="verification-title"
        >
          <div>
            <h2 id="verification-title">Verification System</h2>
            <p>
              A model answer alone is not proof. A verifier separate from the
              executing model is coming soon. What already applies: an external
              action waits for your yes.
            </p>
          </div>
        </section>

        <section id="faq" className="landing-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions</h2>
          {faq(freeTier).map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </section>
      </div>

      <footer className="landing-footer">
        <Link href="/legal/impressum">Imprint</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/eula">EULA</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </footer>
    </main>
  );
}