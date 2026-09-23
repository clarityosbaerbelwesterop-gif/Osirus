"use client";

import {
  Activity,
  Brain,
  FileText,
  ListChecks,
  Puzzle,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { RunSnapshot } from "@/lib/runtime/types";
import { approvalView } from "@/lib/ui/approval-view";
import {
  formatDuration,
  relativeTime,
  stageState,
  toolLabel,
  verdict,
} from "@/lib/ui/labels";
import { list, num, obj, str } from "@/lib/ui/records";
import type { RunView } from "@/lib/ui/run-view";
import { isToolEvent } from "@/lib/ui/workbench-view";
import { ApprovalCard } from "../../approvals/approval-card";
import { Badge } from "../../ui/badge";
import { EmptyState } from "../../ui/empty-state";
import { StatusIcon } from "../../ui/status-icon";

// Workbench views read from the run snapshot. Each shows recorded runtime
// state in plain words; where there is nothing, it says so.

export function ActivityPanel({ view }: { view: RunView }) {
  if (!view.evidence.length)
    return (
      <EmptyState icon={Activity} title="No activity yet">
        Steps appear as the run records them.
      </EmptyState>
    );
  return (
    <ol className="timeline">
      {[...view.evidence].reverse().map((item) => (
        <li key={item.id}>
          <span className="timeline-dot" aria-hidden="true" />
          <span className="timeline-label">{item.label}</span>
          <time className="subtle tabular" dateTime={item.at}>
            {relativeTime(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function PlanPanel({ view }: { view: RunView }) {
  if (!view.stages.length)
    return (
      <EmptyState icon={ListChecks} title="No plan yet">
        The plan appears when the run starts.
      </EmptyState>
    );
  return (
    <div className="wb-section">
      {view.composition.length > 1 ? (
        <p className="subtle wb-note">
          Combines {view.composition.join(" → ")}
        </p>
      ) : null}
      <ol className="plan">
        {view.stages.map((stage, index) => (
          <li key={stage.id} className="plan-step" data-state={stage.state}>
            <StatusIcon state={stage.state} />
            <div className="plan-body">
              <span className="plan-name">
                <span className="subtle tabular">{index + 1}.</span>{" "}
                {stage.name}
              </span>
              <span className="subtle plan-meta">
                {stage.stateLabel}
                {stage.durationMs !== null ? (
                  <>
                    {" · "}
                    <span className="stage-duration">
                      {formatDuration(stage.durationMs)}
                    </span>
                  </>
                ) : (
                  ""
                )}
                {stage.waitsOn.length
                  ? ` · after ${stage.waitsOn.join(", ")}`
                  : ""}
              </span>
            </div>
            {stage.verdictLabel ? (
              <Badge tone={stage.verdictTone ?? "neutral"}>
                {stage.verdictLabel}
              </Badge>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function leaseState(attempt: Record<string, unknown>, now = Date.now()) {
  const status = str(attempt, "status") ?? "created";
  if (status !== "claimed" && status !== "running") return status;
  const expiresAt = str(attempt, "lease_expires_at");
  if (!expiresAt) return status;
  return Date.parse(expiresAt) < now ? "lease expired" : status;
}

export function WorkersPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const names = new Map(
    snapshot.stages.map((stage) => [
      str(stage, "id") ?? "",
      str(stage, "name") ?? "Step",
    ]),
  );
  if (!snapshot.attempts.length)
    return (
      <EmptyState icon={Users} title="No workers yet">
        Each worker that takes a step appears here.
      </EmptyState>
    );
  return (
    <ol className="rows">
      {snapshot.attempts.map((attempt, index) => {
        const state = leaseState(attempt);
        const failure = str(attempt, "failure_class");
        return (
          <li key={str(attempt, "id") ?? String(index)} className="row-item">
            <StatusIcon
              state={stageState(
                state === "completed"
                  ? "completed"
                  : state === "failed"
                    ? "failed"
                    : state === "lease expired"
                      ? "blocked"
                      : "running",
              )}
            />
            <div>
              <p>{names.get(str(attempt, "stage_id") ?? "") ?? "Step"}</p>
              <p className="subtle">
                Attempt {num(attempt, "attempt_number") ?? 1} · {state}
                {failure ? ` · ${failure.replace(/_/g, " ")}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SkillsPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const skills = snapshot.events
    .filter((event) => event.type === "skill.selected")
    .flatMap((event) =>
      list(event.data, "skills").map((entry) => ({
        id: str(entry, "id") ?? "",
        name: str(entry, "name") ?? "Skill",
        version: str(entry, "version"),
      })),
    );
  if (!skills.length)
    return (
      <EmptyState icon={Puzzle} title="No skills selected">
        Skills chosen for this run appear here.
      </EmptyState>
    );
  return (
    <ul className="rows">
      {skills.map((skill, index) => (
        <li key={`${skill.id}:${index}`} className="row-item">
          <Puzzle size={15} aria-hidden="true" className="tone-muted" />
          <p>
            {skill.name}
            {skill.version ? (
              <span className="subtle"> · v{skill.version}</span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ToolsPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const events = snapshot.events.filter((event) =>
    isToolEvent(event.type, event.data),
  );
  if (!events.length)
    return (
      <EmptyState icon={Wrench} title="No tools used">
        Tool and sandbox activity for this run appears here.
      </EmptyState>
    );
  return (
    <ol className="rows">
      {events.map((event) => (
        <li key={event.id} className="row-item">
          <Wrench size={15} aria-hidden="true" className="tone-muted" />
          <div>
            <p>{event.summary}</p>
            <p className="subtle">
              {typeof event.data.toolId === "string"
                ? toolLabel(event.data.toolId)
                : null}
              {typeof event.data.reason === "string"
                ? ` · ${event.data.reason}`
                : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function VerificationPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const stages = snapshot.stages.filter((stage) =>
    str(stage, "verifier_status"),
  );
  if (!stages.length)
    return (
      <EmptyState icon={ShieldCheck} title="No checks yet">
        Verdicts and the evidence behind them appear here.
      </EmptyState>
    );
  return (
    <ol className="checks">
      {stages.map((stage, index) => {
        const info = verdict(str(stage, "verifier_status"));
        const verification = obj(stage, "verification");
        return (
          <li key={str(stage, "id") ?? String(index)} className="check-group">
            <div className="check-head">
              <p className="check-name">{str(stage, "name") ?? "Step"}</p>
              <Badge tone={info.tone}>{info.label}</Badge>
            </div>
            {typeof verification?.summary === "string" ? (
              <p className="subtle">{verification.summary}</p>
            ) : null}
            <ul className="check-list">
              {list(verification, "checks").map((check, checkIndex) => {
                const status = str(check, "status") ?? "";
                const passed = status === "passed";
                const failed = status === "failed";
                return (
                  <li key={str(check, "id") ?? String(checkIndex)}>
                    <StatusIcon
                      state={passed ? "done" : failed ? "failed" : "skipped"}
                      size={14}
                    />
                    <span className="wrap-anywhere">
                      {str(check, "detail") ?? str(check, "id") ?? "Check"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

export function MemoryPanel({ snapshot }: { snapshot: RunSnapshot }) {
  const event = snapshot.events.find(
    (item) => item.type === "memory.retrieved",
  );
  const items = list(event?.data, "items").map((item) => ({
    id: str(item, "id") ?? "",
    verification: str(item, "verification") ?? "unverified",
    excerpt: str(item, "excerpt") ?? "",
  }));
  const count = num(event?.data, "count");
  if (!event || !count)
    return (
      <EmptyState icon={Brain} title="No memory used">
        Nothing from earlier work informed this run.
      </EmptyState>
    );
  return (
    <div className="wb-section">
      <p className="subtle wb-note">
        {count} item{count === 1 ? "" : "s"} from earlier work informed this
        run.
      </p>
      <ul className="rows">
        {items.map((item) => (
          <li key={item.id} className="row-item">
            <Brain size={15} aria-hidden="true" className="tone-muted" />
            <div>
              <p>{item.excerpt}</p>
              <p className="subtle">
                {item.verification === "verified" ? "Verified" : "Not verified"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ArtifactsPanel({
  snapshot,
  onRefresh,
}: {
  snapshot: RunSnapshot;
  onRefresh: () => void;
}) {
  const approvals = snapshot.approvals.map((row) =>
    approvalView({ ...row, run_id: snapshot.run.id }),
  );
  if (!snapshot.artifacts.length && !approvals.length)
    return (
      <EmptyState icon={FileText} title="No artifacts">
        Files and documents this run saves appear here.
      </EmptyState>
    );
  return (
    <div className="wb-section">
      {snapshot.artifacts.length ? (
        <ul className="rows">
          {snapshot.artifacts.map((artifact, index) => (
            <li key={str(artifact, "id") ?? String(index)} className="row-item">
              <FileText size={15} aria-hidden="true" className="tone-muted" />
              <div>
                <p>{str(artifact, "title") ?? "Artifact"}</p>
                <p className="subtle">
                  {(str(artifact, "kind") ?? "artifact").replace(/_/g, " ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {approvals.length ? (
        <section className="stack" aria-labelledby="run-approvals">
          <h3 className="wb-heading" id="run-approvals">
            Approvals
          </h3>
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              runId={snapshot.run.id}
              onDecided={onRefresh}
              compact
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
