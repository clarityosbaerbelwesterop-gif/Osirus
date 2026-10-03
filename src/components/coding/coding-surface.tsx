"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CUSTOMER_MODELS,
  EFFORT_LABEL,
  EFFORTS,
  type CustomerModelId,
  type EffortId,
} from "@/lib/product/surfaces";
import type { RunSnapshot } from "@/lib/runtime/types";
import { chatRunPresentation, chatStatusLine } from "@/lib/ui/chat-status";
import { deriveRunView } from "@/lib/ui/run-view";
import { MessageList, type ChatMessage } from "../chat/message-list";
import { RunCard } from "../run-status/run-card";
import { useShell } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";
import { Badge } from "../ui/badge";
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
  initialModel: CustomerModelId | null;
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
  const [effort, setEffort] = useState<EffortId>(
    props.initialEffort ?? "leicht",
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(Boolean(props.initialRunId));
  const [activeEffort, setActiveEffort] = useState<EffortId | null>(
    props.initialRunId ? props.initialEffort : null,
  );
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [runId, setRunId] = useState(props.initialRunId);

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
    setRunning(!finished);
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

  const start = async () => {
    if (running) return;
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
        coding: { repository, branch, effort, model },
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
    setRunning(true);
    setActiveEffort(effort);
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
    repoKey && branch && branches?.includes(branch) && !failure && !running,
  );

  return (
    <div className="chat-page">
      <div className="chat-column">
        <TopBar
          title="Coding"
          status={
            status ? <Badge tone={status.tone}>{status.label}</Badge> : null
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
            <EffortMotion effort={activeEffort} active={running} />
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
                disabled={running || !repos?.length}
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
                disabled={running || !branches?.length}
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
                disabled={running}
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
            {running ? null : (
              <label>
                Effort
                <select
                  aria-label="Effort"
                  value={effort}
                  onChange={(event) =>
                    setEffort(event.target.value as EffortId)
                  }
                >
                  {EFFORTS.map((item) => (
                    <option key={item} value={item}>
                      {EFFORT_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="sr-only" htmlFor="coding-task">
            Task
          </label>
          <textarea
            id="coding-task"
            className="composer-input"
            value={task}
            disabled={running}
            rows={2}
            placeholder="What should change?"
            onChange={(event) => setTask(event.target.value)}
          />
          <div className="composer-bar">
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
