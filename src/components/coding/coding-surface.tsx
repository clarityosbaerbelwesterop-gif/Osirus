"use client";

import { useCallback, useEffect, useState } from "react";
import {
  codingSlash,
  passesOnAcceptEdits,
  type CodingPermission,
} from "@/lib/coding/intent";
import { navigationLeavesCodingTask } from "@/lib/coding/task-bound";
import {
  codingToolsNeeded,
  routeCodingEffort,
} from "@/lib/product/effort-router";
import { draftAfterSurfaceChange, type EffortId } from "@/lib/product/surfaces";
import type { RunSnapshot } from "@/lib/runtime/types";
import { chatRunPresentation, chatStatusLine } from "@/lib/ui/chat-status";
import { deriveRunView } from "@/lib/ui/run-view";
import { MessageList, type ChatMessage } from "../chat/message-list";
import { FreeQuotaPanel } from "../settings/plan-offer";
import { RunCard } from "../run-status/run-card";
import { LiveRunStarting } from "../run-status/live-run";
import { useShell } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";
import { Badge } from "../ui/badge";
import { EffortField } from "./effort-field";
import { Code2, GitBranch, ShieldCheck, Wand2 } from "lucide-react";
import { ModelPicker } from "../agents-chat/model-picker";
import { useGatewayModels } from "../agents-chat/use-models";

type Repo = {
  owner: string;
  name: string;
  defaultBranch: string;
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * Coding is its own page: repository, branch, model, and effort, then a run.
 * Nothing here is shared with Chat. A run is marked started only after the
 * server accepts the connected grant.
 */
export function CodingSurface(props: {
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  initialRunId: string | null;
  initialEffort: EffortId | null;
  initialEffortChosen?: boolean;
  initialPaused?: boolean;
  initialModel?: string | null;
  initialPermission?: CodingPermission;
  /** A task the Rouge Agent handed over: repository, branch and text. */
  handoff?: {
    repo: string | null;
    branch: string | null;
    task: string | null;
  } | null;
  /** Set by the work page when the free tier is on and its quota is empty. */
  freeQuotaEmpty?: boolean;
  /** When the spent free quota refills (ISO), if known. */
  freeQuotaAvailableAt?: string | null;
}) {
  const shell = useShell();
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(
    props.initialMessages,
  );
  const [task, setTask] = useState(props.handoff?.task ?? "");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoKey, setRepoKey] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState("");
  const handoffRepo = props.handoff?.repo?.toLowerCase() ?? null;
  const handoffBranch = props.handoff?.branch ?? null;
  // Every model a configured key can call; the choice is remembered here.
  const {
    models: gatewayModels,
    freeOnly,
    error: modelsError,
    selected: model,
    choose: setModel,
  } = useGatewayModels("osirus.code.model");
  const [chosen, setChosen] = useState<EffortId | null>(
    props.initialEffortChosen ? props.initialEffort : null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [paused, setPaused] = useState(Boolean(props.initialPaused));
  const [permission, setPermissionState] = useState<CodingPermission>(
    props.initialPermission === "accept-edits" ? "accept-edits" : "ask",
  );
  const [running, setRunning] = useState(
    Boolean(props.initialRunId) && !props.initialPaused,
  );
  const [, setActiveEffort] = useState<EffortId | null>(
    props.initialRunId ? props.initialEffort : null,
  );
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [runId, setRunId] = useState(props.initialRunId);
  const threadKey = props.initialSessionId ?? "new";
  const [seenThread, setSeenThread] = useState(threadKey);
  if (seenThread !== threadKey) {
    setSeenThread(threadKey);
    setTask(draftAfterSurfaceChange("ai", "coding", task));
    setMessages(props.initialMessages);
    setSessionId(props.initialSessionId);
    setRunId(props.initialRunId);
    setRunning(Boolean(props.initialRunId) && !props.initialPaused);
    setSnapshot(null);
    setFailure(null);
    setPaused(Boolean(props.initialPaused));
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/connectors/github/repos", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          repositories?: Repo[];
        };
        if (!response.ok || !body.ok || !body.repositories) {
          setRepos([]);
          setFailure(
            body.message ?? "Repositories konnten nicht geladen werden.",
          );
          return;
        }
        setRepos(body.repositories);
        if (body.repositories.length === 0) {
          setFailure("Für diese Verbindung ist kein Repository freigegeben.");
        }
        const handed = handoffRepo
          ? body.repositories.find(
              (repo) =>
                `${repo.owner}/${repo.name}`.toLowerCase() === handoffRepo,
            )
          : null;
        if (handed) setRepoKey(`${handed.owner}/${handed.name}`);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRepos([]);
        setFailure("Repositories konnten nicht geladen werden.");
      });
    return () => controller.abort();
  }, [handoffRepo]);

  useEffect(() => {
    if (!repoKey) return;
    const [owner, name] = repoKey.split("/");
    if (!owner || !name) return;
    const controller = new AbortController();
    fetch(
      `/api/connectors/github/branches?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          branches?: string[];
        };
        if (!response.ok || !body.ok || !body.branches) {
          setBranches([]);
          setFailure(body.message ?? "Branches konnten nicht geladen werden.");
          return;
        }
        setBranches(body.branches);
        if (body.branches.length === 0) {
          setFailure(
            "Dieses Repository hat noch keinen Branch. Lege zuerst einen ersten Commit an, etwa über den Rouge Agent.",
          );
        } else {
          setFailure(null);
          if (handoffBranch && body.branches.includes(handoffBranch))
            setBranch(handoffBranch);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setBranches([]);
        setFailure("Branches konnten nicht geladen werden.");
      });
    return () => controller.abort();
  }, [repoKey, handoffBranch]);

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`/api/runtime/${id}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;
    const next = (await response.json()) as RunSnapshot;
    setSnapshot(next);
    const finished = TERMINAL.has(next.run.status);
    const nextPaused = Boolean(next.run.pausedAt) && !finished;
    setPaused(nextPaused);
    setRunning(!finished && !nextPaused);
    if (finished) setActiveEffort(null);
    setMessages(next.messages);
    setSessionId(next.run.sessionId);
  }, []);

  useEffect(() => {
    if (!runId || !running) return;
    const id = runId;
    const timer = window.setInterval(() => void refresh(id), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, runId, running]);

  useEffect(() => {
    if (!running || !runId) return;
    const id = runId;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let target: URL;
      try {
        target = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (!navigationLeavesCodingTask(target, new URL(window.location.href)))
        return;
      void fetch(`/api/runtime/${id}/cancel`, { method: "POST" }).catch(
        () => undefined,
      );
      setRunning(false);
      setActiveEffort(null);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [runId, running]);

  const taskText = task.trim() || "Arbeite im gewählten Repository.";
  const suggestion = routeCodingEffort({
    chosen: null,
    task: taskText,
    toolsNeeded: codingToolsNeeded(taskText),
  }).effort;

  const start = async () => {
    if (running || paused) return;
    const repo = repos?.find(
      (item) => `${item.owner}/${item.name}` === repoKey,
    );
    if (!repo || !branch || failure || !branches?.includes(branch)) {
      setFailure(failure ?? "Wähle zuerst ein Repository und einen Branch.");
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    const requestId = crypto.randomUUID();
    const repository = `https://github.com/${repo.owner}/${repo.name}`;
    const objective = [
      task.trim() || "Arbeite im gewählten Repository.",
      repository,
      branch,
    ].join("\n");
    setFailure(null);
    const response = await fetch("/api/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objective,
        requestId,
        sessionId,
        surface: "coding",
        mode: "coding",
        coding: {
          repository,
          branch,
          effort: chosen,
          effortChosen: chosen !== null,
          permission,
          ...(model ? { model } : {}),
        },
      }),
    }).catch(() => null);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as {
        message?: string;
      };
      setFailure(body.message ?? "Die Code-Aufgabe konnte nicht starten.");
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    const started = response.headers.get("X-Osirus-Run-Id");
    const startedSession = response.headers.get("X-Osirus-Session-Id");
    if (!started) {
      setFailure("Die Code-Aufgabe konnte nicht starten.");
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    setPaused(false);
    setRunning(true);
    setActiveEffort(chosen ?? suggestion);
    setRunId(started);
    // The task now lives in the thread above; the field is free for the next.
    setTask("");
    if (startedSession) {
      setSessionId(startedSession);
      shell.upsertSession({
        id: startedSession,
        title: `${repo.owner}/${repo.name}`,
        updatedAt: new Date().toISOString(),
        surface: "coding",
      });
      window.history.replaceState(
        null,
        "",
        `/app/coding?session=${startedSession}`,
      );
    }
    void response.body?.cancel().catch(() => undefined);
    void refresh(started);
  };

  const view = snapshot ? deriveRunView(snapshot) : null;
  const status = view ? chatRunPresentation(view.status) : null;
  const canStart = Boolean(
    repoKey &&
    branch &&
    branches?.includes(branch) &&
    !failure &&
    !running &&
    !paused,
  );

  const setPermission = async (next: CodingPermission) => {
    setPermissionState(next);
    if (!runId) return;
    await fetch(`/api/runtime/${runId}/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission: next }),
    }).catch(() => null);
    if (next !== "accept-edits") return;
    const edit = view?.pendingApprovals.find((item) =>
      passesOnAcceptEdits(item.toolId),
    );
    if (!edit) return;
    await fetch(`/api/runtime/${runId}/approvals/${edit.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    }).catch(() => null);
    void refresh(runId);
  };

  const control = async (action: "pause" | "resume") => {
    if (!runId) return;
    if (action === "pause" && !running) return;
    if (action === "resume" && !paused) return;
    const response = await fetch(`/api/runtime/${runId}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    if (!response?.ok) return;
    if (action === "pause") {
      setPaused(true);
      setRunning(false);
      return;
    }
    setPaused(false);
    setRunning(true);
    void refresh(runId);
  };

  return (
    <div className="chat-page">
      <div className="chat-column">
        <TopBar
          title="Code"
          status={
            paused ? (
              <Badge tone="warning">Pausiert</Badge>
            ) : status ? (
              <Badge tone={status.tone}>{status.label}</Badge>
            ) : null
          }
        />
        <div className="chat-scroll">
          <div className="chat-content">
            {props.freeQuotaEmpty ? (
              <FreeQuotaPanel
                availableAt={props.freeQuotaAvailableAt ?? null}
              />
            ) : null}
            {messages.length ? (
              <MessageList
                messages={messages}
                runObjective={view?.objective ?? null}
                streamingId={null}
                runSlot={
                  view ? (
                    <RunCard
                      view={view}
                      resumed
                      onRefresh={() => {
                        if (runId) void refresh(runId);
                      }}
                      onOpenWorkbench={null}
                    />
                  ) : null
                }
              />
            ) : (
              <div className="code-hero">
                <div className="code-hero-icon" aria-hidden="true">
                  <Code2 size={26} />
                </div>
                <h1 className="code-hero-title">Code</h1>
                <p className="code-hero-sub">
                  Repository und Branch wählen, Aufgabe beschreiben. Osirus
                  ändert den Code in einer Sandbox, führt die Tests aus und
                  zeigt dir den Diff, bevor etwas zurückgeschrieben wird.
                </p>
                <ol className="code-steps">
                  <li style={{ ["--d" as string]: "0ms" }}>
                    <GitBranch size={15} aria-hidden="true" /> Repository wählen
                  </li>
                  <li style={{ ["--d" as string]: "60ms" }}>
                    <Wand2 size={15} aria-hidden="true" /> Aufgabe beschreiben
                  </li>
                  <li style={{ ["--d" as string]: "120ms" }}>
                    <ShieldCheck size={15} aria-hidden="true" /> Diff prüfen
                  </li>
                </ol>
              </div>
            )}
            {running && !view ? <LiveRunStarting kind="coding" /> : null}
            {status ? (
              <p className="sr-only" role="status">
                {status.label}.{" "}
                {chatStatusLine(view?.status, view?.failure?.message)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="code-dock">
          <form
            className="code-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const slash = codingSlash(task);
              if (slash) {
                if (slash === "pause") void control("pause");
                else if (slash === "resume") void control("resume");
                else if (slash === "accept-edits")
                  void setPermission("accept-edits");
                else if (slash === "ask") void setPermission("ask");
                else setFailure("Diesen Befehl gibt es nicht.");
                if (slash !== "unknown") setFailure(null);
                setTask("");
                return;
              }
              void start();
            }}
          >
            {failure ? (
              <p className="composer-error" role="alert">
                {failure}
              </p>
            ) : null}
            <div className="coding-picks">
              <label>
                Repository
                <select
                  aria-label="Repository"
                  value={repoKey}
                  disabled={running || paused || !repos?.length}
                  onChange={(event) => {
                    setFailure(repos?.length ? null : failure);
                    setBranches(null);
                    setBranch("");
                    setRepoKey(event.target.value);
                  }}
                >
                  <option value="">Repository wählen</option>
                  {repos?.map((repo) => (
                    <option
                      key={`${repo.owner}/${repo.name}`}
                      value={`${repo.owner}/${repo.name}`}
                    >
                      {repo.owner}/{repo.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch
                <select
                  aria-label="Branch"
                  value={branch}
                  disabled={running || paused || !branches?.length}
                  onChange={(event) => {
                    setFailure(null);
                    setBranch(event.target.value);
                  }}
                >
                  <option value="">Branch wählen</option>
                  {branches?.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="coding-model">
                <span className="coding-model-label">Modell</span>
                <ModelPicker
                  models={gatewayModels}
                  value={model}
                  onChange={setModel}
                  disabled={running || paused}
                  freeOnly={freeOnly}
                  error={modelsError}
                />
              </div>
              {running || paused ? null : (
                <EffortField
                  chosen={chosen}
                  suggestion={task.trim() ? suggestion : null}
                  onChoose={setChosen}
                />
              )}
            </div>
            <label className="sr-only" htmlFor="coding-task">
              Aufgabe
            </label>
            <textarea
              id="coding-task"
              className="composer-input"
              value={task}
              rows={2}
              placeholder="Was soll sich ändern?"
              onChange={(event) => setTask(event.target.value)}
            />
            <div className="composer-bar">
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={permission === "accept-edits"}
                onClick={() =>
                  void setPermission(
                    permission === "accept-edits" ? "ask" : "accept-edits",
                  )
                }
              >
                Änderungen ohne Rückfrage
              </button>
              {running ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void control("pause")}
                >
                  Pausieren
                </button>
              ) : null}
              {paused ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void control("resume")}
                >
                  Fortsetzen
                </button>
              ) : null}
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={!canStart}
              >
                Starten
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
