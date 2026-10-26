import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/chat/markdown";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { sharedThread } from "@/lib/gateway/shares";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const thread = await sharedThread(token).catch(() => null);
  return {
    title: thread ? `${thread.title} · geteilt mit Osirus` : "Geteilter Chat",
    // A shared chat is for the people who get the link, not for search.
    robots: { index: false, follow: false },
  };
}

/** A chat someone shared: read-only, as it was when they shared it. */
export default async function SharedChatPage({ params }: Props) {
  const { token } = await params;
  const thread = await sharedThread(token).catch(() => null);
  if (!thread) notFound();
  const sharedAt = new Date(thread.sharedAt).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  });
  return (
    <main className="shared" lang="de">
      <header className="shared-head">
        <Link className="shared-brand" href="/">
          <OsirusMark />
          Osirus
        </Link>
        <Link className="btn btn-primary" href="/auth/sign-up">
          Selbst ausprobieren
        </Link>
      </header>
      <article className="shared-body">
        <p className="shared-meta">Geteilter Chat · {sharedAt}</p>
        <h1>{thread.title}</h1>
        <div className="shared-thread">
          {thread.messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="ac-row ac-row-user">
                <div className="ac-user">{message.content}</div>
              </div>
            ) : (
              <div key={message.id} className="shared-answer">
                <div className="ac-answer">
                  <Markdown content={message.content} />
                </div>
                {message.sources?.length ? (
                  <section className="ac-sources" aria-label="Quellen">
                    <p className="ac-sources-title">Quellen</p>
                    <ol>
                      {message.sources.map((source) => (
                        <li key={source.n} value={source.n}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            <span className="ac-source-title">
                              {source.title}
                            </span>
                            <span className="ac-source-domain">
                              {source.domain}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
              </div>
            ),
          )}
        </div>
        <p className="shared-note">
          Schreibgeschützte Kopie. Spätere Nachrichten im Original-Chat sind
          hier nicht zu sehen. KI-Antworten können Fehler enthalten.
        </p>
      </article>
    </main>
  );
}
