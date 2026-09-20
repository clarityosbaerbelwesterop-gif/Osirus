"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSnapshot, RuntimePacket } from "@/lib/runtime/types";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
};

type Activity = {
  id: string;
  label: string;
  at?: string;
};

export function ChatHub(props: {
  workspaceName: string;
  initialSessionId: string | null;
  initialMessages: Message[];
  initialRunId: string | null;
}) {
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [objective, setObjective] = useState("");
  const [activeRunId, setActiveRunId] = useState(props.initialRunId);
  const [running, setRunning] = useState(Boolean(props.initialRunId));
  const [error, setError] = useState<string | null>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const applySnapshot = useCallback((snapshot: RunSnapshot) => {
    setSessionId(snapshot.run.sessionId);
    setActiveRunId(
      ["completed", "failed", "cancelled"].includes(snapshot.run.status)
        ? null
        : snapshot.run.id,
    );
    setRunning(
      !["completed", "failed", "cancelled"].includes(snapshot.run.status),
    );
    setMessages(snapshot.messages);
    setActivities(
      snapshot.events
        .filter((event) => event.visibility === "user")
        .map((event) => ({
          id: event.id,
          label: event.summary,
          at: event.at,
        })),
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
    const runId = props.initialRunId;
    if (!runId) return;
    const refreshInitialRun = () => {
      void refreshRun(runId);
    };
    const initial = window.setTimeout(refreshInitialRun, 0);
    const timer = window.setInterval(() => {
      void refreshRun(runId);
    }, 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [props.initialRunId, refreshRun]);

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
          return;
        case "error":
          setError(packet.message);
          setRunning(false);
          return;
      }
    },
    [applySnapshot],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || running) return;

    setObjective("");
    setError(null);
    setRunning(true);
    setActivities([]);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: trimmed },
    ]);

    const controller = new AbortController();
    streamAbort.current = controller;
    const response = await fetch("/api/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: trimmed,
        requestId: crypto.randomUUID(),
        sessionId,
      }),
      signal: controller.signal,
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return null;
      throw requestError;
    });

    if (!response) return;
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      setRunning(false);
      setError(
        typeof body.error === "string" ? body.error : "Run request failed",
      );
      return;
    }

    const headerSession = response.headers.get("X-Osirus-Session-Id");
    const headerRun = response.headers.get("X-Osirus-Run-Id");
    if (headerSession) setSessionId(headerSession);
    if (headerRun) setActiveRunId(headerRun);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const payload = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!payload) continue;
          applyPacket(JSON.parse(payload) as RuntimePacket);
        }
      }
    } finally {
      reader.releaseLock();
      streamAbort.current = null;
    }
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
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">OSIRUS</div>
        <p className="muted">{props.workspaceName}</p>
        <div className="section">
          <span className="pill">ChatHub</span>
          <p className="muted">Durable runtime · Memory · Skills</p>
        </div>
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
                    <p>{message.content}</p>
                  </article>
                ))}
            </div>
          )}
          {error ? <p className="form-error">{error}</p> : null}
        </section>

        <form className="composer" onSubmit={submit}>
          <input
            aria-label="Message"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Give Osirus an objective…"
            disabled={running}
          />
          {running ? (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button type="submit">Run</button>
          )}
        </form>
      </main>

      <aside className="workbench">
        <strong>Activity</strong>
        <div className="activity-list">
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
      </aside>
    </div>
  );
}
