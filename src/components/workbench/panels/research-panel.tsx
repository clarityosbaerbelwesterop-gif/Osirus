"use client";

import { BookOpen, ExternalLink } from "lucide-react";
import type { Tone } from "@/lib/ui/labels";
import { Badge } from "../../ui/badge";
import { EmptyState } from "../../ui/empty-state";
import { useJson } from "../use-json";

// Claims and the sources behind them, from the run's evidence store. A claim
// shows its verification state and the exact excerpt that supports or
// contradicts it; sources show who published them and how they were found.

type ResearchView = {
  documents: Array<{
    id: string;
    url: string;
    title: string | null;
    publisher: string | null;
    authority: string;
    provider: string;
    published_at: string | null;
  }>;
  claims: Array<{
    id: string;
    statement: string;
    status: string;
    confidence: string | number;
    evidence: Array<{ documentId: string; relation: string; excerpt: string }>;
  }>;
};

const CLAIM_TONE: Record<string, Tone> = {
  supported: "success",
  contested: "warning",
  stale: "warning",
  unsupported: "danger",
};

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchPanel({
  runId,
  live,
}: {
  runId: string | null;
  live: boolean;
}) {
  const { data, error, loading } = useJson<ResearchView>(
    runId ? `/api/research/${runId}` : null,
    live ? 5_000 : null,
  );
  if (!runId) return <EmptyState title="No run selected" />;
  if (loading && !data)
    return (
      <div className="wb-loading" aria-busy="true">
        Loading sources…
      </div>
    );
  if (error)
    return (
      <EmptyState title="Sources unavailable">
        They could not be loaded right now.
      </EmptyState>
    );
  if (!data || (data.documents.length === 0 && data.claims.length === 0))
    return (
      <EmptyState icon={BookOpen} title="No sources yet">
        Sources appear here as research finds and reads them.
      </EmptyState>
    );
  const byId = new Map(data.documents.map((doc) => [doc.id, doc]));
  return (
    <div className="wb-section">
      {data.claims.length ? (
        <section aria-labelledby="claims-heading" className="stack">
          <h3 className="wb-heading" id="claims-heading">
            Claims <span className="subtle tabular">{data.claims.length}</span>
          </h3>
          <ol className="claims">
            {data.claims.map((claim) => (
              <li key={claim.id} className="claim">
                <div className="claim-head">
                  <Badge
                    tone={CLAIM_TONE[claim.status.toLowerCase()] ?? "neutral"}
                  >
                    {claim.status.toLowerCase()}
                  </Badge>
                  <p>{claim.statement}</p>
                </div>
                {claim.evidence.map((link, index) => {
                  const doc = byId.get(link.documentId);
                  return (
                    <blockquote
                      key={`${link.documentId}:${index}`}
                      className="claim-evidence"
                    >
                      <p>“{link.excerpt}”</p>
                      <footer className="subtle">
                        {link.relation === "contradicts"
                          ? "Contradicted by "
                          : "Supported by "}
                        {doc ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {doc.publisher ?? host(doc.url)}
                          </a>
                        ) : (
                          "a retrieved document"
                        )}
                      </footer>
                    </blockquote>
                  );
                })}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <section aria-labelledby="sources-heading" className="stack">
        <h3 className="wb-heading" id="sources-heading">
          Sources{" "}
          <span className="subtle tabular">{data.documents.length}</span>
        </h3>
        <ol className="sources">
          {data.documents.map((doc, index) => (
            <li key={doc.id} className="source">
              <span className="source-index tabular" aria-hidden="true">
                {index + 1}
              </span>
              <div className="source-body">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="source-title"
                >
                  {doc.title || doc.url}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <span className="subtle source-meta">
                  {doc.publisher ?? host(doc.url)} · {doc.authority}
                  {doc.published_at
                    ? ` · ${doc.published_at.slice(0, 10)}`
                    : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
