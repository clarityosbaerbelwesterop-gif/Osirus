"use client";

import { Pause, Play, Plus, Timer, Trash2, Zap } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutomationView } from "@/lib/automations/store-types";
import { formatCount, formatUsd, runStatus } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EmptyState } from "../ui/empty-state";
import { AutomationForm } from "./automation-form";
import { RelativeTime } from "../ui/relative-time";

const TRIGGER_LABEL: Record<AutomationView["trigger"], string> = {
  schedule: "Schedule",
  run_completed: "After a run completes",
  connector_changed: "When a connection changes",
};

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  return {
    ok: Boolean(response?.ok),
    body: (await response?.json().catch(() => ({}))) as { sessionId?: string },
  };
}

function AutomationCard({ automation }: { automation: AutomationView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const base = `/api/automations/${automation.id}`;
  const status = automation.lastStatus
    ? runStatus(automation.lastStatus)
    : null;

  const act = async (
    key: string,
    run: () => Promise<{ ok: boolean; body: { sessionId?: string } }>,
  ) => {
    setBusy(key);
    setMessage(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) setMessage("That did not work. Try again.");
    else if (key === "run")
      setMessage(
        "Started. It runs in the background; open it to follow along.",
      );
    router.refresh();
  };

  return (
    <article
      className="card automation"
      aria-labelledby={`automation-${automation.id}`}
    >
      <header className="automation-head">
        <span className="conn-icon" aria-hidden="true">
          {automation.trigger === "schedule" ? (
            <Timer size={18} />
          ) : (
            <Zap size={18} />
          )}
        </span>
        <div className="conn-title">
          <h3 id={`automation-${automation.id}`}>{automation.name}</h3>
          <p className="subtle">
            {automation.scheduleLabel ?? TRIGGER_LABEL[automation.trigger]}
          </p>
        </div>
        <Badge tone={automation.enabled ? "success" : "neutral"}>
          {automation.enabled ? "Active" : "Paused"}
        </Badge>
      </header>
      <p className="automation-objective">{automation.objective}</p>
      <dl className="conn-health">
        <div>
          <dt>Next run</dt>
          <dd className="tabular">
            {!automation.enabled ? (
              "Paused"
            ) : automation.trigger !== "schedule" ? (
              "On the next matching event"
            ) : automation.nextRunAt ? (
              <RelativeTime value={automation.nextRunAt} />
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd className="tabular">
            {automation.lastRunAt ? (
              <RelativeTime value={automation.lastRunAt} />
            ) : (
              "Never"
            )}
          </dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : "—"}
            {automation.sessionId ? (
              <>
                {" "}
                <Link href={`/app?session=${automation.sessionId}` as Route}>
                  Open
                </Link>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd className="tabular">
            {automation.maxCostUsd || automation.maxTokens
              ? [
                  automation.maxCostUsd
                    ? formatUsd(automation.maxCostUsd)
                    : null,
                  automation.maxTokens
                    ? `${formatCount(automation.maxTokens)} tokens`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Default run limits"}
          </dd>
        </div>
        <div>
          <dt>Autonomy</dt>
          <dd>
            {automation.policyPreset === "balanced" ? "Balanced" : "Cautious"}
          </dd>
        </div>
      </dl>
      {message ? (
        <p className="subtle" role="status">
          {message}
        </p>
      ) : null}
      <footer className="conn-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy !== null}
          onClick={() => void act("run", () => call(`${base}/run`, "POST"))}
        >
          <Play size={14} aria-hidden="true" />
          {busy === "run" ? "Starting…" : "Run now"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy !== null}
          onClick={() =>
            void act("toggle", () =>
              call(base, "PATCH", { enabled: !automation.enabled }),
            )
          }
        >
          {automation.enabled ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
          {automation.enabled ? "Pause" : "Resume"}
        </button>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="btn btn-danger-quiet btn-sm"
              disabled={busy !== null}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          }
          title={`Delete ${automation.name}?`}
          description="Future runs stop. Past runs and their conversations stay."
          confirmLabel="Delete automation"
          onConfirm={() => void act("delete", () => call(base, "DELETE"))}
        />
      </footer>
    </article>
  );
}

export function AutomationList({
  automations,
}: {
  automations: AutomationView[];
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack">
      {!creating && automations.length ? (
        <div className="list-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} aria-hidden="true" />
            New automation
          </button>
        </div>
      ) : null}
      {creating ? <AutomationForm onDone={() => setCreating(false)} /> : null}
      {automations.map((automation) => (
        <AutomationCard key={automation.id} automation={automation} />
      ))}
      {!creating && !automations.length ? (
        <EmptyState
          icon={Timer}
          title="No automations yet"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} aria-hidden="true" />
              New automation
            </button>
          }
        >
          Run an objective every day, every weekday or once a week, or when
          something happens. It works like a chat task, with the same approvals.
        </EmptyState>
      ) : null}
    </div>
  );
}
