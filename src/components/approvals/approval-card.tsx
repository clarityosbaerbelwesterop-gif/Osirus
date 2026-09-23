"use client";

import { Check, ChevronRight, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalView } from "@/lib/ui/approval-view";
import { relativeTime } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cx } from "../ui/cx";

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

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    setError(null);
    const response = await fetch(
      `/api/runtime/${runId}/approvals/${approval.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    ).catch(() => null);
    setBusy(null);
    if (response?.ok) onDecided();
    else if (response?.status === 404)
      setError(
        "This request is no longer open. It may have expired or been decided already.",
      );
    else setError("Your decision was not recorded. Try again.");
  };

  const highRisk =
    approval.riskLevel === "high" || approval.riskLevel === "critical";
  const approveButton = (
    <button
      type="button"
      className="btn btn-sm btn-primary"
      disabled={busy !== null}
    >
      <Check size={14} aria-hidden="true" />
      {busy === "approved" ? "Approving…" : "Approve"}
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
            {approval.decidable ? "Approval needed" : approval.statusLabel}
          </p>
          <h3 id={`approval-title-${approval.id}`}>{approval.title}</h3>
        </div>
        <Badge tone={approval.riskTone}>{approval.riskLabel}</Badge>
      </header>

      <dl className="approval-facts">
        {approval.why ? (
          <div>
            <dt>Why</dt>
            <dd>{approval.why}</dd>
          </div>
        ) : null}
        {approval.target ? (
          <div>
            <dt>Target</dt>
            <dd className="wrap-anywhere mono">{approval.target}</dd>
          </div>
        ) : null}
        <div>
          <dt>Scope</dt>
          <dd>{approval.scope}</dd>
        </div>
      </dl>

      {approval.details.length && !compact ? (
        <details className="disclosure">
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            Exact input ({approval.details.length})
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
            {approval.expiresAt
              ? `Expires ${relativeTime(approval.expiresAt)}`
              : null}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={busy !== null}
            onClick={() => void decide("rejected")}
          >
            <X size={14} aria-hidden="true" />
            {busy === "rejected" ? "Rejecting…" : "Reject"}
          </button>
          {highRisk ? (
            <ConfirmDialog
              trigger={approveButton}
              title={`Approve: ${approval.title}?`}
              description={
                <>
                  <p>{approval.scope}.</p>
                  {approval.target ? (
                    <p className="wrap-anywhere">Target: {approval.target}</p>
                  ) : null}
                  <p>This approval covers this exact input only.</p>
                </>
              }
              confirmLabel="Approve and continue"
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
              {busy === "approved" ? "Approving…" : "Approve"}
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
