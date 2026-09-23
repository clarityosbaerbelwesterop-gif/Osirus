"use client";

import { ChevronRight, PanelRightOpen } from "lucide-react";
import { formatDuration, relativeTime } from "@/lib/ui/labels";
import type { RunView } from "@/lib/ui/run-view";
import { resumeSummary } from "@/lib/ui/run-view";
import { ApprovalCard } from "../approvals/approval-card";
import { Badge } from "../ui/badge";
import { StatusIcon } from "../ui/status-icon";

/**
 * The run, inline in the conversation: which steps are done, which one is
 * running, what is waiting for the person, and -- on request -- the recorded
 * activity behind it. No model reasoning is shown; only runtime state.
 */
export function RunCard({
  view,
  resumed,
  onRefresh,
  onOpenWorkbench,
}: {
  view: RunView;
  resumed: boolean;
  onRefresh: () => void;
  onOpenWorkbench: (() => void) | null;
}) {
  const summary = resumeSummary(view);
  const progress = Math.round(view.progress * 100);
  return (
    <section className="run" aria-label={`Run: ${view.statusLabel}`}>
      <header className="run-head">
        <div className="run-title">
          <span className="run-arm">{view.armLabel}</span>
          <Badge tone={view.tone}>{view.statusLabel}</Badge>
          {view.totalCount ? (
            <span className="subtle tabular">
              {view.doneCount} of {view.totalCount} steps
            </span>
          ) : null}
        </div>
        {onOpenWorkbench ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onOpenWorkbench}
          >
            <PanelRightOpen size={14} aria-hidden="true" />
            Details
          </button>
        ) : null}
      </header>

      {view.live && view.totalCount ? (
        <div
          className="run-progress"
          role="progressbar"
          aria-label="Steps completed"
          aria-valuemin={0}
          aria-valuemax={view.totalCount}
          aria-valuenow={view.doneCount}
        >
          <span
            style={{ transform: `scaleX(${Math.max(progress, 2) / 100})` }}
          />
        </div>
      ) : null}

      {resumed &&
      (summary.attention.length || (view.live && summary.completed.length)) ? (
        <div className="run-resume">
          <p className="overline">Since you were last here</p>
          {summary.completed.length ? (
            <p>
              <span className="subtle">Completed: </span>
              {summary.completed.join(" · ")}
            </p>
          ) : null}
          {summary.inProgress ? (
            <p>
              <span className="subtle">Now: </span>
              {summary.inProgress}
            </p>
          ) : null}
          {summary.attention.length ? (
            <p>
              <span className="subtle">Needs you: </span>
              {summary.attention.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.stages.length ? (
        <details className="disclosure run-steps-wrap" open={view.live}>
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            {view.live ? "Steps" : `Steps (${view.totalCount})`}
          </summary>
          <ol className="run-steps">
            {view.stages.map((stage) => {
              const current = view.current?.id === stage.id;
              return (
                <li
                  key={stage.id}
                  className="run-step"
                  data-state={stage.state}
                  aria-current={current ? "step" : undefined}
                >
                  <StatusIcon state={stage.state} />
                  <div className="run-step-body">
                    <span className="run-step-name">{stage.name}</span>
                    {current && view.currentStep ? (
                      <span className="run-step-now">{view.currentStep}</span>
                    ) : null}
                  </div>
                  <span className="run-step-meta">
                    {stage.verdictLabel ? (
                      <Badge tone={stage.verdictTone ?? "neutral"}>
                        {stage.verdictLabel}
                      </Badge>
                    ) : null}
                    <span className="sr-only">{stage.stateLabel}</span>
                    {stage.durationMs !== null ? (
                      <span className="tabular subtle">
                        {formatDuration(stage.durationMs)}
                      </span>
                    ) : (
                      <span className="subtle" aria-hidden="true">
                        {stage.stateLabel}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      ) : view.live ? (
        <p className="run-now subtle">{view.currentStep ?? "Starting…"}</p>
      ) : null}

      {view.failure ? (
        <div className="notice notice-danger" role="status">
          <span>
            {view.failure.stage ? (
              <strong>{view.failure.stage}: </strong>
            ) : null}
            {view.failure.message}
          </span>
        </div>
      ) : null}

      {view.pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          runId={view.runId}
          onDecided={onRefresh}
        />
      ))}

      {view.evidence.length ? (
        <details className="disclosure">
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            Activity ({view.evidence.length})
          </summary>
          <ol className="run-evidence">
            {view.evidence.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <time className="subtle tabular" dateTime={item.at}>
                  {relativeTime(item.at)}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
