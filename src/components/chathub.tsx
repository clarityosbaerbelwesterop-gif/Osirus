"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunSnapshot, RuntimePacket } from "@/lib/runtime/types";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
};

type Activity = { id: string; label: string; at?: string };
type WorkspaceSession = { id: string; title: string; updatedAt: string };
type WorkbenchTab =
  | "activity"
  | "plan"
  | "arms"
  | "workers"
  | "verification"
  | "memory"
  | "artifacts";

const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "plan", label: "Plan" },
  { id: "arms", label: "Arms" },
  { id: "workers", label: "Workers" },
  { id: "verification", label: "Verification" },
  { id: "memory", label: "Memory" },
  { id: "artifacts", label: "Artifacts" },
];

const VERDICT_LABEL: Record<string, string> = {
  verified: "Verified",
  rejected: "Rejected",
  conflicted: "Conflicted",
  unverified: "Not verified",
};
type SessionState = {
  sessionId: string;
  messages: Message[];
  activeRunId: string | null;
  recentRunId: string | null;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/```/);
  return (
    <div className="message-content">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre key={`${index}:${block.slice(0, 20)}`}>
            <code>{block.trim()}</code>
          </pre>
        ) : (
          block
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((paragraph, paragraphIndex) => (
              <p key={`${index}:${paragraphIndex}`}>{paragraph}</p>
            ))
        ),
      )}
    </div>
  );
}

function recordString(value: unknown, key: string) {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "string"
    ? String((value as Record<string, unknown>)[key])
    : null;
}

function recordNumber(value: unknown, key: string) {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function recordObject(value: unknown, key: string) {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : null;
}

type VerificationCheckRow = {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  detail?: unknown;
  required?: unknown;
};

function checksOf(stage: Record<string, unknown>): VerificationCheckRow[] {
  const verification = recordObject(stage, "verification");
  const checks = verification?.checks;
  return Array.isArray(checks) ? (checks as VerificationCheckRow[]) : [];
}

/**
 * Elapsed lease time, so a worker that stopped heartbeating is visible rather
 * than looking identical to one that is still working.
 */
function leaseState(attempt: Record<string, unknown>) {
  const status = recordString(attempt, "status") ?? "created";
  if (status !== "claimed" && status !== "running") return status;
  const expiresAt = recordString(attempt, "lease_expires_at");
  if (!expiresAt) return status;
  return Date.parse(expiresAt) < Date.now() ? "lease expired" : status;
}

export function ChatHub(props: {
  workspaceName: string;
  initialSessionId: string | null;
  initialMessages: Message[];
  initialRunId: string | null;
  initialSnapshotRunId: string | null;
  initialSessions: WorkspaceSession[];
}) {
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [sessions, setSessions] = useState(props.initialSessions);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [objective, setObjective] = useState("");
  const [search, setSearch] = useState("");
  const [activeRunId, setActiveRunId] = useState(props.initialRunId);
  const [running, setRunning] = useState(Boolean(props.initialRunId));
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkbenchTab>("activity");
  const streamAbort = useRef<AbortController | null>(null);
  const streamEnd = useRef<HTMLDivElement | null>(null);

  const applySnapshot = useCallback((next: RunSnapshot) => {
    setSnapshot(next);
    setSessionId(next.run.sessionId);
    setActiveRunId(terminalStatuses.has(next.run.status) ? null : next.run.id);
    setRunning(!terminalStatuses.has(next.run.status));
    setMessages(next.messages);
    setActivities(
      next.events
        .filter((event) => event.visibility === "user")
        .map((event) => ({ id: event.id, label: event.summary, at: event.at })),
    );
  }, []);

  const refreshRun = useCallback(
    async (runId: string) => {
      const response = await fetch(`/api/runtime/${runId}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      applySnapshot((await response.json()) as RunSnapshot);
    },
    [applySnapshot],
  );

  useEffect(() => {
    const runId = props.initialRunId ?? props.initialSnapshotRunId;
    if (!runId) return;
    const initial = window.setTimeout(() => void refreshRun(runId), 0);
    if (!props.initialRunId) {
      return () => window.clearTimeout(initial);
    }
    const timer = window.setInterval(() => void refreshRun(runId), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [props.initialRunId, props.initialSnapshotRunId, refreshRun]);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    streamEnd.current?.scrollIntoView({
      block: "end",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [messages]);

  const applyPacket = useCallback(
    (packet: RuntimePacket) => {
      switch (packet.kind) {
        case "started":
          setActiveRunId(packet.runId);
          setSessionId(packet.sessionId);
          return;
        case "snapshot":
          applySnapshot(packet.snapshot);
          return;
        case "event":
          if (packet.event.visibility === "user") {
            setActivities((current) => [
              ...current.filter((item) => item.id !== packet.event.id),
              {
                id: packet.event.id,
                label: packet.event.summary,
                at: packet.event.at,
              },
            ]);
          }
          if (
            ["stage.started", "stage.completed", "stage.failed"].includes(
              packet.event.type,
            )
          ) {
            void refreshRun(packet.event.runId);
          }
          return;
        case "delta":
          setMessages((current) => {
            const last = current.at(-1);
            if (last?.id === `stream:${packet.runId}`) {
              return [
                ...current.slice(0, -1),
                { ...last, content: last.content + packet.text },
              ];
            }
            return [
              ...current,
              {
                id: `stream:${packet.runId}`,
                role: "assistant",
                content: packet.text,
              },
            ];
          });
          return;
        case "done":
          setRunning(false);
          setActiveRunId(null);
          void refreshRun(packet.runId);
          return;
        case "error":
          setError(packet.message);
          setRunning(false);
          return;
      }
    },
    [applySnapshot, refreshRun],
  );

  const runObjective = useCallback(
    async (value: string, regenerate = false) => {
      const trimmed = value.trim();
      if (!trimmed || running) return;
      const requestId = crypto.randomUUID();
      setObjective("");
      setError(null);
      setRunning(true);
      setSnapshot(null);
      setActivities([]);
      if (!regenerate) {
        setMessages((current) => [
          ...current,
          { id: `pending:${requestId}`, role: "user", content: trimmed },
        ]);
      }

      const controller = new AbortController();
      streamAbort.current = controller;
      try {
        const response = await fetch("/api/runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: trimmed,
            requestId,
            sessionId,
            regenerate,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string" ? body.error : "Run request failed",
          );
        }
        const headerSession = response.headers.get("X-Osirus-Session-Id");
        const headerRun = response.headers.get("X-Osirus-Run-Id");
        if (headerSession) {
          setSessionId(headerSession);
          if (!sessions.some((item) => item.id === headerSession)) {
            setSessions((current) => [
              {
                id: headerSession,
                title: trimmed.slice(0, 120),
                updatedAt: new Date().toISOString(),
              },
              ...current,
            ]);
          }
        }
        if (headerRun) setActiveRunId(headerRun);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(chunk, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const payload = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n");
              if (payload) applyPacket(JSON.parse(payload) as RuntimePacket);
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Run request failed",
          );
          setRunning(false);
        }
      } finally {
        streamAbort.current = null;
      }
    },
    [applyPacket, running, sessionId, sessions],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runObjective(objective);
  }

  async function cancel() {
    const runId = activeRunId;
    if (!runId) return;
    await fetch(`/api/runtime/${runId}/cancel`, { method: "POST" }).catch(
      () => undefined,
    );
    streamAbort.current?.abort();
    setActivities((current) => [
      ...current,
      { id: `cancel:${runId}`, label: "Cancelling" },
    ]);
    window.setTimeout(() => void refreshRun(runId), 500);
  }

  async function createChat() {
    if (running) return;
    setError(null);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      if (!response.ok) throw new Error("session_create_failed");
      const created = (await response.json()) as WorkspaceSession;
      setSessions((current) => [created, ...current]);
      setSessionId(created.id);
      setMessages([]);
      setActiveRunId(null);
      setActivities([]);
      setSnapshot(null);
    } catch {
      setError("Could not create a new chat.");
    }
  }

  async function switchSession(next: WorkspaceSession) {
    if (running || next.id === sessionId) return;
    setError(null);
    const response = await fetch(`/api/sessions/${next.id}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      setError("Could not load that chat.");
      return;
    }
    const state = (await response.json()) as SessionState;
    setSessionId(state.sessionId);
    setMessages(state.messages);
    setActiveRunId(state.activeRunId);
    setRunning(Boolean(state.activeRunId));
    setActivities([]);
    setSnapshot(null);
    if (state.recentRunId) void refreshRun(state.recentRunId);
  }

  const visibleSessions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? sessions.filter((item) => item.title.toLowerCase().includes(needle))
      : sessions;
  }, [search, sessions]);
  const lastObjective = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  const planStages = snapshot?.stages ?? [];
  const attempts = snapshot?.attempts ?? [];
  const artifacts = snapshot?.artifacts ?? [];
  const approvals = snapshot?.approvals ?? [];
  const dependencies = snapshot?.dependencies ?? [];
  const stageNameById = new Map(
    planStages.map((stage) => [
      recordString(stage, "id") ?? "",
      recordString(stage, "name") ?? "Stage",
    ]),
  );
  const dependenciesByStage = new Map<string, string[]>();
  for (const edge of dependencies) {
    const stageId = recordString(edge, "stage_id");
    const dependsOn = recordString(edge, "depends_on_stage_id");
    if (!stageId || !dependsOn) continue;
    dependenciesByStage.set(stageId, [
      ...(dependenciesByStage.get(stageId) ?? []),
      stageNameById.get(dependsOn) ?? "a previous stage",
    ]);
  }
  const armId = snapshot?.run.armId ?? null;
  const contract = snapshot?.run.acceptanceContract ?? null;
  const successCriteria = Array.isArray(contract?.successCriteria)
    ? (contract.successCriteria as unknown[]).map(String)
    : [];
  const routing = recordObject(contract, "routing");
  const verifiedStages = planStages.filter((stage) =>
    recordString(stage, "verifier_status"),
  );
  const memoryEvent = snapshot?.events.find(
    (event) => event.type === "memory.retrieved",
  );
  const memoryCount =
    memoryEvent && typeof memoryEvent.data.count === "number"
      ? memoryEvent.data.count
      : null;

  return (
    <div className="shell">
      <aside className="rail" aria-label="Workspace and sessions">
        <div className="brand">OSIRUS</div>
        <p className="muted">{props.workspaceName}</p>
        <button
          className="rail-new-chat"
          type="button"
          onClick={createChat}
          disabled={running}
        >
          + New chat
        </button>
        <label className="session-search">
          <span className="sr-only">Search chats</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
          />
        </label>
        <nav className="session-list" aria-label="Chats">
          {visibleSessions.length ? (
            visibleSessions.map((item) => (
              <button
                className={`session-item ${item.id === sessionId ? "session-item-active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => void switchSession(item)}
                disabled={running}
              >
                {item.title}
              </button>
            ))
          ) : (
            <p className="muted">No matching chats.</p>
          )}
        </nav>
        <a className="rail-settings" href="/app/settings">
          Settings
        </a>
      </aside>

      <main className="chat">
        <header className="top">
          <strong>ChatHub</strong>
          <span className="muted">
            {running ? " · run active" : " · ready"}
          </span>
        </header>

        <section className="stream" aria-live="polite">
          {messages.length === 0 ? (
            <div className="hero">
              <p className="eyebrow">AGENT OPERATING SYSTEM</p>
              <h1>What should Osirus execute?</h1>
              <p className="muted">
                Runs, events, checkpoints, memory and skill selections are
                persisted server-side.
              </p>
            </div>
          ) : (
            <div className="messages">
              {messages
                .filter((message) => message.role !== "system")
                .map((message) => (
                  <article
                    className={`message message-${message.role}`}
                    key={message.id}
                  >
                    <span>{message.role === "user" ? "You" : "Osirus"}</span>
                    <MessageContent content={message.content} />
                  </article>
                ))}
            </div>
          )}
          <div ref={streamEnd} />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <form className="composer" onSubmit={submit}>
          <textarea
            aria-label="Message"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void runObjective(objective);
              }
            }}
            placeholder="Give Osirus an objective…"
            disabled={running}
            rows={1}
          />
          {running ? (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button type="submit">Run</button>
          )}
          {!running && lastObjective ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => void runObjective(lastObjective, true)}
            >
              Regenerate
            </button>
          ) : null}
        </form>
      </main>

      <aside className="workbench" aria-label="Run workbench">
        <div
          className="workbench-tabs"
          role="tablist"
          aria-label="Workbench tabs"
        >
          {WORKBENCH_TABS.map((item) => (
            <button
              aria-selected={tab === item.id}
              className={
                tab === item.id ? "workbench-tab-active" : "workbench-tab"
              }
              key={item.id}
              onClick={() => setTab(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "activity" ? (
          <div className="activity-list" role="status">
            {activities.length ? (
              activities.map((activity) => (
                <div className="activity" key={activity.id}>
                  <span className="activity-dot" />
                  <span>{activity.label}</span>
                </div>
              ))
            ) : (
              <p className="muted">Runtime events appear here.</p>
            )}
          </div>
        ) : null}
        {tab === "plan" ? (
          <div className="workbench-panel">
            {planStages.length ? (
              planStages.map((stage, index) => {
                const stageId = recordString(stage, "id") ?? String(index);
                const waitsOn = dependenciesByStage.get(stageId) ?? [];
                return (
                  <p key={stageId}>
                    <strong>{recordString(stage, "name") ?? "Stage"}</strong>
                    <span className="muted">
                      {" "}
                      · {recordString(stage, "status") ?? "pending"}
                    </span>
                    {waitsOn.length ? (
                      <span className="muted">
                        {" "}
                        · after {waitsOn.join(", ")}
                      </span>
                    ) : null}
                  </p>
                );
              })
            ) : (
              <p className="muted">
                A durable stage plan appears when a run begins.
              </p>
            )}
          </div>
        ) : null}
        {tab === "arms" ? (
          <div className="workbench-panel">
            {armId ? (
              <>
                <p>
                  <strong>{armId}</strong>
                  {routing && Array.isArray(routing.composition) ? (
                    <span className="muted">
                      {" "}
                      ·{" "}
                      {(routing.composition as unknown[])
                        .map(String)
                        .join(" → ")}
                    </span>
                  ) : null}
                </p>
                {routing ? (
                  <p className="muted">{String(routing.reason ?? "")}</p>
                ) : null}
                {successCriteria.length ? (
                  <>
                    <p>
                      <strong>Success criteria</strong>
                    </p>
                    {successCriteria.map((criterion) => (
                      <p className="muted" key={criterion}>
                        {criterion}
                      </p>
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              <p className="muted">
                The arm and its acceptance contract appear once a run is
                planned.
              </p>
            )}
          </div>
        ) : null}
        {tab === "workers" ? (
          <div className="workbench-panel">
            {attempts.length ? (
              attempts.map((attempt, index) => {
                const stageId = recordString(attempt, "stage_id") ?? "";
                const failure = recordString(attempt, "failure_class");
                return (
                  <p key={recordString(attempt, "id") ?? String(index)}>
                    <strong>{stageNameById.get(stageId) ?? "Stage"}</strong>
                    <span className="muted">
                      {" "}
                      · attempt {recordNumber(attempt, "attempt_number") ??
                        1} · {leaseState(attempt)}
                    </span>
                    {failure ? (
                      <span className="muted"> · {failure}</span>
                    ) : null}
                  </p>
                );
              })
            ) : (
              <p className="muted">
                Each worker that takes a stage appears here with its lease.
              </p>
            )}
          </div>
        ) : null}
        {tab === "verification" ? (
          <div className="workbench-panel">
            {verifiedStages.length ? (
              verifiedStages.map((stage, index) => {
                const status = recordString(stage, "verifier_status") ?? "";
                const verification = recordObject(stage, "verification");
                return (
                  <div key={recordString(stage, "id") ?? String(index)}>
                    <p>
                      <strong>{recordString(stage, "name") ?? "Stage"}</strong>
                      <span className="muted">
                        {" "}
                        · {VERDICT_LABEL[status] ?? status}
                      </span>
                    </p>
                    {verification?.summary ? (
                      <p className="muted">{String(verification.summary)}</p>
                    ) : null}
                    {checksOf(stage).map((check, checkIndex) => (
                      <p
                        className="muted"
                        key={`${String(check.id ?? checkIndex)}`}
                      >
                        {String(check.type ?? "CHECK")} ·{" "}
                        {String(check.status ?? "")} ·{" "}
                        {String(check.detail ?? "")}
                      </p>
                    ))}
                  </div>
                );
              })
            ) : (
              <p className="muted">
                Verification verdicts and the evidence behind them appear here.
              </p>
            )}
          </div>
        ) : null}
        {tab === "memory" ? (
          <div className="workbench-panel">
            <p>
              <strong>Context summary</strong>
            </p>
            <p className="muted">
              {memoryCount === null
                ? "No run-specific memory has been retrieved yet."
                : `${memoryCount} relevant memory item${memoryCount === 1 ? "" : "s"} informed this run.`}
            </p>
            <p className="muted">
              Osirus exposes useful context, not internal memory-layer details.
            </p>
          </div>
        ) : null}
        {tab === "artifacts" ? (
          <div className="workbench-panel">
            {approvals.length ? (
              <>
                <p>
                  <strong>Approvals</strong>
                </p>
                {approvals.map((approval, index) => (
                  <p
                    className="muted"
                    key={recordString(approval, "id") ?? String(index)}
                  >
                    {recordString(approval, "action") ?? "Action"} ·{" "}
                    {recordString(approval, "status") ?? "pending"} ·{" "}
                    {recordString(approval, "risk") ?? "low"} risk
                  </p>
                ))}
              </>
            ) : null}
            {artifacts.length ? (
              artifacts.map((artifact, index) => (
                <p key={recordString(artifact, "id") ?? String(index)}>
                  <strong>
                    {recordString(artifact, "title") ?? "Artifact"}
                  </strong>
                  <span className="muted">
                    {" "}
                    · {recordString(artifact, "kind") ?? "artifact"}
                  </span>
                </p>
              ))
            ) : (
              <p className="muted">
                No artifacts have been persisted for this run.
              </p>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
