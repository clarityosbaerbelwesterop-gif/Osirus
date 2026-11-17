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
  schedule: "Zeitplan",
  run_completed: "Nach einem fertigen Lauf",
  connector_changed: "Wenn sich eine Verbindung ändert",
  webhook: "Wenn ein Webhook eintrifft",
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
    if (!result.ok)
      setMessage("Das hat nicht geklappt. Versuch es noch einmal.");
    else if (key === "run")
      setMessage(
        "Gestartet. Sie läuft im Hintergrund; öffne sie, um mitzuverfolgen.",
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
          {automation.enabled ? "Aktiv" : "Pausiert"}
        </Badge>
      </header>
      <p className="automation-objective">{automation.objective}</p>
      <dl className="conn-health">
        <div>
          <dt>Nächster Lauf</dt>
          <dd className="tabular">
            {!automation.enabled ? (
              "Pausiert"
            ) : automation.trigger !== "schedule" ? (
              "Beim nächsten passenden Ereignis"
            ) : automation.nextRunAt ? (
              <RelativeTime value={automation.nextRunAt} />
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Letzter Lauf</dt>
          <dd className="tabular">
            {automation.lastRunAt ? (
              <RelativeTime value={automation.lastRunAt} />
            ) : (
              "Nie"
            )}
          </dd>
        </div>
        <div>
          <dt>Ergebnis</dt>
          <dd>
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : "—"}
            {automation.sessionId ? (
              <>
                {" "}
                <Link href={`/app?session=${automation.sessionId}` as Route}>
                  Öffnen
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
                    ? `${formatCount(automation.maxTokens)} Tokens`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Standardgrenzen für Läufe"}
          </dd>
        </div>
        <div>
          <dt>Autonomie</dt>
          <dd>
            {automation.policyPreset === "balanced"
              ? "Ausgewogen"
              : "Vorsichtig"}
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
          {busy === "run" ? "Startet…" : "Jetzt ausführen"}
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
          {automation.enabled ? "Pausieren" : "Fortsetzen"}
        </button>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="btn btn-danger-quiet btn-sm"
              disabled={busy !== null}
            >
              <Trash2 size={14} aria-hidden="true" />
              Löschen
            </button>
          }
          title={`${automation.name} löschen?`}
          description="Künftige Läufe entfallen. Bisherige Läufe und ihre Unterhaltungen bleiben."
          confirmLabel="Automation löschen"
          onConfirm={() => void act("delete", () => call(base, "DELETE"))}
        />
      </footer>
    </article>
  );
}

export function AutomationList({
  automations,
  endpoints = [],
}: {
  automations: AutomationView[];
  endpoints?: Array<{ id: string; name: string; source: string }>;
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
            Neue Automation
          </button>
        </div>
      ) : null}
      {creating ? (
        <AutomationForm
          endpoints={endpoints}
          onDone={() => setCreating(false)}
        />
      ) : null}
      {automations.map((automation) => (
        <AutomationCard key={automation.id} automation={automation} />
      ))}
      {!creating && !automations.length ? (
        <EmptyState
          icon={Timer}
          title="Noch keine Automationen"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} aria-hidden="true" />
              Neue Automation
            </button>
          }
        >
          Führe ein Ziel jeden Tag, werktags oder einmal pro Woche aus, oder
          wenn etwas passiert. Es funktioniert wie eine Chat-Aufgabe, mit
          denselben Freigaben.
        </EmptyState>
      ) : null}
    </div>
  );
}
