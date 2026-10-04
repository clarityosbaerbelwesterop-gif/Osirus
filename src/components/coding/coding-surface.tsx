"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  CUSTOMER_MODELS,
  draftAfterSurfaceChange,
  type CustomerModelId,
  type EffortId,
} from "@/lib/product/surfaces";
import type { RunSnapshot } from "@/lib/runtime/types";
import { chatRunPresentation, chatStatusLine } from "@/lib/ui/chat-status";
import { showWorkingMotion } from "@/lib/ui/live-activity";
import { deriveRunView } from "@/lib/ui/run-view";
import { MessageList, type ChatMessage } from "../chat/message-list";
import { RunCard } from "../run-status/run-card";
import { useShell } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";
import { Badge } from "../ui/badge";
import { EffortField } from "./effort-field";
import { EffortMotion } from "./effort-motion";

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
  initialModel: CustomerModelId | null;
  initialPermission?: CodingPermission;
}) {
  const shell = useShell();
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(
    props.initialMessages,
  );
  const [task, setTask] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoKey, setRepoKey] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState("");
  const [model, setModel] = useState<CustomerModelId>(
    props.initialModel ?? "rouge",
  );
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
  const [activeEffort, setActiveEffort] = useState<EffortId | null>(
    props.initialRunId ? props.initialEffort : null,
  );
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [runId, setRunId] = useState(props.initialRunId);
  const threadKey = props.initialSessionId ?? "new";
  const seenThread = useRef(threadKey);
  if (seenThread.current !== threadKey) {
    seenThread.current = threadKey;
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
          setFailure(body.message ?? "Repositories could not be listed.");
          return;
        }
        setRepos(body.repositories);
        if (body.repositories.length === 0) {
          setFailure("The connected grant has no repositories.");
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRepos([]);
        setFailure("Repositories could not be listed.");
      });
    return () => controller.abort();
  }, []);

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
          setFailure(body.message ?? "Branches could not be listed.");
          return;
        }
        setBranches(body.branches);
        if (body.branches.length === 0) {
          setFailure("That repository has no branches.");
        } else {
          setFailure(null);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setBranches([]);
        setFailure("Branches could not be listed.");
      });
    return () => controller.abort();
  }, [repoKey]);

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

  const taskText = task.trim() || "Work in the selected repository.";
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
      setFailure(
        failure ?? "Choose a repository and a branch before starting.",
      );
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    const requestId = crypto.randomUUID();
    const repository = `https://github.com/${repo.owner}/${repo.name}`;
    const objective = [
      task.trim() || "Work in the selected repository.",
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
          model,
        },
      }),
    }).catch(() => null);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as {
        message?: string;
      };
      setFailure(body.message ?? "The coding run did not start.");
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    const started = response.headers.get("X-Osirus-Run-Id");
    const startedSession = response.headers.get("X-Osirus-Session-Id");
    if (!started) {
      setFailure("The coding run did not start.");
      setRunning(false);
      setActiveEffort(null);
      return;
    }
    setPaused(false);
    setRunning(true);
    setActiveEffort(chosen ?? suggestion);
    setRunId(started);
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
          title="Coding"
          status={
            paused ? (
              <Badge tone="warning">Paused</Badge>
            ) : status ? (
              <Badge tone={status.tone}>{status.label}</Badge>
            ) : null
          }
        />
        <div className="chat-scroll">
          <div className="chat-content">
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
              <div className="home home-calm">
                <p className="home-title">Coding</p>
              </div>
            )}
            <EffortMotion
              effort={activeEffort}
              active={showWorkingMotion({
                label: status?.label ?? (running ? "Starting" : null),
                paused,
              })}
            />
            {status ? (
              <p className="sr-only" role="status">
                {status.label}.{" "}
                {chatStatusLine(view?.status, view?.failure?.message)}
              </p>
            ) : null}
          </div>
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            const slash = codingSlash(task);
            if (slash) {
              if (slash === "pause") void control("pause");
              else if (slash === "resume") void control("resume");
              else if (slash === "accept-edits")
                void setPermission("accept-edits");
              else if (slash === "ask") void setPermission("ask");
              else setFailure("That is not a command.");
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
                <option value="">Choose a repository</option>
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
                <option value="">Choose a branch</option>
                {branches?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select
                aria-label="Model"
                value={model}
                disabled={running || paused}
                onChange={(event) =>
                  setModel(event.target.value as CustomerModelId)
                }
              >
                {CUSTOMER_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {running || paused ? null : (
              <EffortField
                chosen={chosen}
                suggestion={task.trim() ? suggestion : null}
                onChoose={setChosen}
              />
            )}
          </div>
          <label className="sr-only" htmlFor="coding-task">
            Task
          </label>
          <textarea
            id="coding-task"
            className="composer-input"
            value={task}
            rows={2}
            placeholder="What should change?"
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
              Accept edits
            </button>
            {running ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void control("pause")}
              >
                Pause
              </button>
            ) : null}
            {paused ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void control("resume")}
              >
                Resume
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!canStart}
            >
              Start
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
