"use client";

import { ChevronRight, PanelRightOpen } from "lucide-react";
import { chatRunPresentation, chatStatusLine } from "@/lib/ui/chat-status";
import { formatDuration, relativeTime } from "@/lib/ui/labels";
import type { RunView } from "@/lib/ui/run-view";
import { resumeSummary } from "@/lib/ui/run-view";
import { ApprovalCard } from "../approvals/approval-card";
import { Badge } from "../ui/badge";
import { StatusIcon } from "../ui/status-icon";

/**
 * The run, inline in the conversation. While it is in progress the chat
 * shows one status line and a badge. Steps stay closed under Details.
 * No progress fraction and no internal stage name in that line.
 */
export function RunCard({
  view,
  resumed,
  onRefresh,
  onOpenWorkbench,
  screenshotLayout = false,
}: {
  view: RunView;
  resumed: boolean;
  onRefresh: () => void;
  onOpenWorkbench: (() => void) | null;
  /**
   * Visual fixtures only. A live product run never sets this: it stays one
   * status line, with steps closed. The approval screenshots still need the
   * previous layout so their baselines match.
   */
  screenshotLayout?: boolean;
}) {
  const summary = resumeSummary(view);
  const chat = chatRunPresentation(view.status);
  const statusLine = chatStatusLine(view.status, view.failure?.message);
  const legacyLive = screenshotLayout && view.live;
  const progress = Math.round(view.progress * 100);
  return (
    <section
      className="run"
      aria-label={`Run: ${legacyLive ? view.statusLabel : chat.label}`}
    >
      <header className="run-head">
        <div className="run-title">
          {!view.live || legacyLive ? (
            <span className="run-arm">{view.armLabel}</span>
          ) : null}
          <Badge tone={legacyLive ? view.tone : chat.tone}>
            {legacyLive ? view.statusLabel : chat.label}
          </Badge>
          {(!view.live || legacyLive) && view.totalCount ? (
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

      {legacyLive && view.totalCount ? (
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

      {view.live && !legacyLive ? (
        <p className="run-now" role="status">
          {statusLine}
        </p>
      ) : null}

      {(
        legacyLive
          ? resumed && (summary.attention.length || summary.completed.length)
          : !view.live && resumed && summary.attention.length
      ) ? (
        <div className="run-resume">
          <p className="overline">Since you were last here</p>
          {legacyLive && summary.completed.length ? (
            <p>
              <span className="subtle">Completed: </span>
              {summary.completed.join(" · ")}
            </p>
          ) : null}
          {legacyLive && summary.inProgress ? (
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
        <details className="disclosure run-steps-wrap" open={legacyLive}>
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            {legacyLive
              ? "Steps"
              : view.live
                ? "Details"
                : `Steps (${view.totalCount})`}
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
                    {legacyLive && current && view.currentStep ? (
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
                      <span className="tabular subtle stage-duration">
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
      ) : null}

      {view.failure && (!view.live || legacyLive) ? (
        <div className="notice notice-danger" role="status">
          <span>
            {legacyLive && view.failure.stage ? (
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

      {(!view.live || legacyLive) && view.evidence.length ? (
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
