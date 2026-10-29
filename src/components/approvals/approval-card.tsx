"use client";

import { Check, ChevronRight, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalView } from "@/lib/ui/approval-view";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cx } from "../ui/cx";
import { RelativeTime } from "../ui/relative-time";

/**
 * One decision, in context. What will happen, why, where, how risky, and the
 * exact input -- as labelled values, never JSON. High-risk approvals ask for a
 * second confirmation. The decision is recorded by the API; this card never
 * assumes the outcome.
 */
export function ApprovalCard({
  approval,
  runId,
  onDecided,
  compact = false,
}: {
  approval: ApprovalView;
  runId: string;
  onDecided: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (
    decision: "approved" | "rejected",
    adjustment?: string,
  ) => {
    setBusy(decision);
    setError(null);
    const response = await fetch(
      `/api/runtime/${runId}/approvals/${approval.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(adjustment ? { adjustment } : {}),
        }),
      },
    ).catch(() => null);
    setBusy(null);
    if (response?.ok) onDecided();
    else if (response?.status === 404)
      setError(
        "Diese Anfrage ist nicht mehr offen. Sie ist abgelaufen oder wurde schon entschieden.",
      );
    else
      setError(
        "Deine Entscheidung wurde nicht gespeichert. Bitte versuche es noch einmal.",
      );
  };

  const [target, setTarget] = useState(approval.intent?.target ?? "");
  const intent = approval.intent;
  const yes = () => {
    if (!intent) return;
    const next = target.trim();
    if (!next) return;
    if (next === intent.target) void decide("approved");
    else {
      const sentence = [intent.text, next, intent.tail]
        .filter(Boolean)
        .join(" ");
      void decide("rejected", sentence);
    }
  };

  if (intent) {
    return (
      <article
        className="approval approval-intent"
        id={`approval-${approval.id}`}
        data-intent="true"
        aria-label={`${intent.text} ${intent.target}${intent.tail ? ` ${intent.tail}` : ""}`}
      >
        <p className="intent-line">
          <span>{intent.text}</span>
          <input
            value={target}
            aria-label={intent.target}
            spellCheck={false}
            onChange={(event) => setTarget(event.target.value)}
          />
          {intent.tail ? <span>{intent.tail}</span> : null}
        </p>
        {intent.diff.length ? (
          <pre className="intent-diff">
            {intent.diff.map((line, index) => (
              <span
                key={index}
                className={line.kind === "add" ? "diff-add" : "diff-remove"}
              >
                {line.kind === "add" ? "+" : "-"}
                {line.text}
              </span>
            ))}
          </pre>
        ) : null}
        {approval.decidable ? (
          <footer className="approval-actions">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy !== null}
              onClick={() => void decide("rejected")}
            >
              <X size={14} aria-hidden="true" />
              {busy === "rejected" ? "Wird abgelehnt …" : "Ablehnen"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy !== null || !target.trim()}
              onClick={yes}
            >
              <Check size={14} aria-hidden="true" />
              {busy === "approved" ? "Wird erlaubt …" : "Erlauben"}
            </button>
          </footer>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
    );
  }

  const highRisk =
    approval.riskLevel === "high" || approval.riskLevel === "critical";
  const approveButton = (
    <button
      type="button"
      className="btn btn-sm btn-primary"
      disabled={busy !== null}
    >
      <Check size={14} aria-hidden="true" />
      {busy === "approved" ? "Wird freigegeben …" : "Freigeben"}
    </button>
  );

  return (
    <article
      className={cx(
        "approval",
        approval.decidable && "approval-open",
        compact && "approval-compact",
      )}
      id={`approval-${approval.id}`}
      aria-labelledby={`approval-title-${approval.id}`}
    >
      <header className="approval-head">
        {approval.decidable ? (
          <ShieldAlert size={18} aria-hidden="true" className="tone-warning" />
        ) : (
          <ShieldCheck size={18} aria-hidden="true" className="tone-muted" />
        )}
        <div className="approval-heading">
          <p className="overline">
            {approval.decidable ? "Freigabe nötig" : approval.statusLabel}
          </p>
          <h3 id={`approval-title-${approval.id}`}>{approval.title}</h3>
        </div>
        <Badge tone={approval.riskTone}>{approval.riskLabel}</Badge>
      </header>

      <dl className="approval-facts">
        {approval.why ? (
          <div>
            <dt>Warum</dt>
            <dd>{approval.why}</dd>
          </div>
        ) : null}
        {approval.target ? (
          <div>
            <dt>Ziel</dt>
            <dd className="wrap-anywhere mono">{approval.target}</dd>
          </div>
        ) : null}
        <div>
          <dt>Umfang</dt>
          <dd>{approval.scope}</dd>
        </div>
      </dl>

      {approval.details.length && !compact ? (
        <details className="disclosure">
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            Genaue Eingabe ({approval.details.length})
          </summary>
          <dl className="approval-details">
            {approval.details.map((detail, index) => (
              <div key={`${detail.label}:${index}`}>
                <dt>{detail.label}</dt>
                <dd className="wrap-anywhere">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {approval.decidable ? (
        <footer className="approval-actions">
          <span className="subtle approval-expiry">
            {approval.expiresAt ? (
              <>
                Läuft ab <RelativeTime value={approval.expiresAt} />
              </>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy !== null}
            onClick={() => void decide("rejected")}
          >
            <X size={14} aria-hidden="true" />
            {busy === "rejected" ? "Wird abgelehnt …" : "Ablehnen"}
          </button>
          {highRisk ? (
            <ConfirmDialog
              trigger={approveButton}
              title={`${approval.title} freigeben?`}
              description={
                <>
                  <p>{approval.scope}.</p>
                  {approval.target ? (
                    <p className="wrap-anywhere">Ziel: {approval.target}</p>
                  ) : null}
                  <p>Die Freigabe gilt nur für genau diese Eingabe.</p>
                </>
              }
              confirmLabel="Freigeben und fortfahren"
              tone="primary"
              onConfirm={() => void decide("approved")}
            />
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy !== null}
              onClick={() => void decide("approved")}
            >
              <Check size={14} aria-hidden="true" />
              {busy === "approved" ? "Wird freigegeben …" : "Freigeben"}
            </button>
          )}
        </footer>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
