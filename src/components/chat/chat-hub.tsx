"use client";

import { PanelRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunSnapshot, RuntimePacket } from "@/lib/runtime/types";
import { repositoryInObjective } from "@/lib/coding/repository-ref";
import { deriveRunView, TERMINAL } from "@/lib/ui/run-view";
import type { Starter } from "@/lib/ui/starters";
import {
  autoOpenWorkbench,
  defaultTab,
  type WorkbenchTab,
} from "@/lib/ui/workbench-view";
import {
  Composer,
  type ComposerAttachment,
  type ComposerHandle,
  type GithubState,
} from "../composer/composer";
import { RunCard } from "../run-status/run-card";
import { useShell, type SessionSummary } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/icon-button";
import { useWideLayout, Workbench } from "../workbench/workbench";
import { ChatHome, type OnboardingStep } from "./chat-home";
import { MessageList, type ChatMessage } from "./message-list";

// ChatHub: the conversation, its runs and the workbench.
//
// This container owns the runtime protocol exactly as before the redesign:
// POST /api/runtime streams server-sent packets (started, snapshot, event,
// delta, done, error); GET /api/runtime/:id returns the durable snapshot;
// a live run is polled every two seconds after a reload; cancel is
// POST /api/runtime/:id/cancel; sessions load from /api/sessions/:id. The
// presentation lives in the components it renders.

type Activity = { id: string; label: string; at?: string };

type SessionState = {
  sessionId: string;
  messages: ChatMessage[];
  activeRunId: string | null;
  recentRunId: string | null;
};

const terminalStatuses = TERMINAL;

export function ChatHub(props: {
  firstName: string | null;
  workspaceName: string;
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  initialRunId: string | null;
  initialSnapshotRunId: string | null;
  /** Server-provided snapshot, so the first paint already shows the run. */
  initialSnapshot?: RunSnapshot | null;
  onboarding?: OnboardingStep[];
}) {
  const shell = useShell();
  const { upsertSession, bindChat } = shell;
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(
    props.initialMessages,
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(
    props.initialSnapshot ?? null,
  );
  const [objective, setObjective] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeRunId, setActiveRunId] = useState(props.initialRunId);
  const [running, setRunning] = useState(
    Boolean(props.initialRunId) ||
      Boolean(
        props.initialSnapshot &&
        !TERMINAL.has(props.initialSnapshot.run.status),
      ),
  );
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedObjective, setFailedObjective] = useState<string | null>(null);
  const [resumed, setResumed] = useState(
    Boolean(
      props.initialRunId ?? props.initialSnapshotRunId ?? props.initialSnapshot,
    ),
  );
  const [workbenchOpen, setWorkbenchOpen] = useState<boolean | null>(null);
  const [tab, setTab] = useState<WorkbenchTab | null>(null);
  const [width, setWidth] = useState(420);
  const [github, setGithub] = useState<GithubState>({ status: "loading" });
  // Set once the GitHub status request has answered; a ref, so recording it
  // does not re-run the effect and abort the request it belongs to.
  const githubRequested = useRef(false);
  const streamAbort = useRef<AbortController | null>(null);
  const streamEnd = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const composer = useRef<ComposerHandle | null>(null);
  const wide = useWideLayout();

  const applySnapshot = useCallback((next: RunSnapshot) => {
    setSnapshot(next);
    setSessionId(next.run.sessionId);
    setActiveRunId(terminalStatuses.has(next.run.status) ? null : next.run.id);
    setRunning(!terminalStatuses.has(next.run.status));
    if (terminalStatuses.has(next.run.status)) setCancelling(false);
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
    if (!nearBottom.current) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    streamEnd.current?.scrollIntoView({
      block: "end",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [messages, snapshot]);

  // Content can grow after the scroll above: web fonts swap in, lazy Markdown
  // renders, a run card expands. While the reader is at the bottom, stay
  // there, so the latest line never ends up below the fold.
  useEffect(() => {
    const node = content.current;
    const frame = scroller.current;
    if (!node || !frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) frame.scrollTop = frame.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
          setCancelling(false);
          setActiveRunId(null);
          void refreshRun(packet.runId);
          return;
        case "error":
          setError(packet.message);
          setRunning(false);
          setCancelling(false);
          return;
      }
    },
    [applySnapshot, refreshRun],
  );

  const attachFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        if (sessionId) form.append("sessionId", sessionId);
        const response = await fetch("/api/attachments", {
          method: "POST",
          body: form,
        });
        const body = (await response.json().catch(() => ({}))) as {
          attachment?: ComposerAttachment;
          error?: string;
        };
        if (!response.ok || !body.attachment) {
          setError(
            body.error === "too_large"
              ? "That file is larger than 10 MB."
              : body.error === "limit_reached"
                ? "Today's attachment limit for this workspace is reached."
                : body.error === "unsupported_type"
                  ? "That file type cannot be read. Try PDF, text, Markdown, CSV, JSON, code or an image."
                  : "The file could not be uploaded.",
          );
          return;
        }
        const attachment = body.attachment;
        setAttachments((current) => [...current, attachment].slice(-8));
      } finally {
        setUploading(false);
      }
    },
    [sessionId],
  );

  const removeAttachment = useCallback(async (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    await fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }, []);

  const runObjective = useCallback(
    async (value: string, regenerate = false) => {
      const trimmed = value.trim();
      if (!trimmed || running) return;
      const requestId = crypto.randomUUID();
      setObjective("");
      setError(null);
      setFailedObjective(null);
      setRunning(true);
      setSnapshot(null);
      setActivities([]);
      setResumed(false);
      setWorkbenchOpen(null);
      setTab(null);
      nearBottom.current = true;
      if (!regenerate) {
        setMessages((current) => [
          ...current,
          { id: `pending:${requestId}`, role: "user", content: trimmed },
        ]);
      }

      const controller = new AbortController();
      streamAbort.current = controller;
      try {
        const attachmentIds = regenerate
          ? []
          : attachments.map((attachment) => attachment.id);
        setAttachments([]);
        const response = await fetch("/api/runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: trimmed,
            requestId,
            sessionId,
            regenerate,
            ...(attachmentIds.length ? { attachmentIds } : {}),
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
          if (!shell.sessions.some((item) => item.id === headerSession)) {
            upsertSession({
              id: headerSession,
              title: trimmed.slice(0, 120),
              updatedAt: new Date().toISOString(),
            });
          }
          window.history.replaceState(
            null,
            "",
            `/app?session=${headerSession}`,
          );
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
          setFailedObjective(regenerate ? null : trimmed);
          setRunning(false);
        }
      } finally {
        streamAbort.current = null;
      }
    },
    [
      applyPacket,
      attachments,
      running,
      sessionId,
      shell.sessions,
      upsertSession,
    ],
  );

  const cancel = useCallback(async () => {
    const runId = activeRunId;
    if (!runId) return;
    setCancelling(true);
    await fetch(`/api/runtime/${runId}/cancel`, { method: "POST" }).catch(
      () => undefined,
    );
    streamAbort.current?.abort();
    setActivities((current) => [
      ...current,
      { id: `cancel:${runId}`, label: "Cancelling" },
    ]);
    window.setTimeout(() => void refreshRun(runId), 500);
  }, [activeRunId, refreshRun]);

  const newTask = useCallback(() => {
    if (running) return;
    setError(null);
    setFailedObjective(null);
    setSessionId(null);
    setMessages([]);
    setActiveRunId(null);
    setActivities([]);
    setSnapshot(null);
    setResumed(false);
    setWorkbenchOpen(null);
    window.history.replaceState(null, "", "/app?new=1");
    window.setTimeout(() => composer.current?.focus(), 0);
  }, [running]);

  const switchSession = useCallback(
    async (next: SessionSummary) => {
      if (running || next.id === sessionId) return;
      setError(null);
      setFailedObjective(null);
      const response = await fetch(`/api/sessions/${next.id}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Could not load that conversation.");
        return;
      }
      const state = (await response.json()) as SessionState;
      setSessionId(state.sessionId);
      setMessages(state.messages);
      setActiveRunId(state.activeRunId);
      setRunning(Boolean(state.activeRunId));
      setActivities([]);
      setSnapshot(null);
      setResumed(true);
      setWorkbenchOpen(null);
      setTab(null);
      nearBottom.current = true;
      window.history.replaceState(null, "", `/app?session=${state.sessionId}`);
      if (state.recentRunId) void refreshRun(state.recentRunId);
    },
    [refreshRun, running, sessionId],
  );

  useEffect(() => {
    bindChat({
      activeSessionId: sessionId,
      running,
      select: (item) => void switchSession(item),
      newTask,
    });
    return () => bindChat(null);
  }, [bindChat, newTask, running, sessionId, switchSession]);

  const hasRepository = Boolean(repositoryInObjective(objective));
  useEffect(() => {
    if (!hasRepository || githubRequested.current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/connectors/github", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            status?: string;
            login?: string;
          };
          githubRequested.current = true;
          setGithub(
            body.status === "CONNECTED" && body.login
              ? { status: "CONNECTED", login: body.login }
              : {
                  status:
                    body.status === "NOT_CONFIGURED"
                      ? "NOT_CONFIGURED"
                      : "NOT_CONNECTED",
                },
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          githubRequested.current = true;
          setGithub({ status: "unknown" });
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasRepository]);

  const view = useMemo(
    () => (snapshot ? deriveRunView(snapshot) : null),
    [snapshot],
  );
  const liveView = useMemo(() => {
    if (!view || !view.live) return view;
    const latest = activities.at(-1)?.label;
    return latest ? { ...view, currentStep: latest } : view;
  }, [activities, view]);

  const lastObjective = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  const streamingId =
    running && messages.at(-1)?.id.startsWith("stream:")
      ? messages.at(-1)!.id
      : null;
  const open = workbenchOpen ?? (wide && autoOpenWorkbench(snapshot));
  const activeTab = tab ?? defaultTab(snapshot);
  const title =
    shell.sessions.find((item) => item.id === sessionId)?.title ??
    (messages.length ? "Conversation" : "New task");
  const empty = messages.length === 0 && !running;
  const pendingApproval = liveView?.pendingApprovals[0];
  const liveStatus = liveView
    ? `${liveView.statusLabel}${liveView.live && liveView.current ? `: ${liveView.current.name}` : ""}`
    : "";

  const refresh = useCallback(() => {
    if (snapshot) void refreshRun(snapshot.run.id);
  }, [refreshRun, snapshot]);

  const start = (starter: Starter) => {
    setObjective(starter.prefix);
    window.setTimeout(() => composer.current?.focus(), 0);
  };

  return (
    <div
      className="chat-page"
      data-workbench={open && wide ? "open" : "closed"}
    >
      <div className="chat-column">
        <TopBar
          title={title}
          status={
            liveView ? (
              <Badge tone={liveView.tone}>{liveView.statusLabel}</Badge>
            ) : null
          }
          actions={
            snapshot ? (
              <IconButton
                label={open ? "Hide run details" : "Show run details"}
                icon={PanelRight}
                aria-pressed={open}
                onClick={() => setWorkbenchOpen(!open)}
              />
            ) : null
          }
        />
        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            nearBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 120;
          }}
        >
          <div className="chat-content" ref={content}>
            {empty ? (
              <ChatHome
                firstName={props.firstName}
                onStart={start}
                onboarding={props.onboarding}
              />
            ) : (
              <MessageList
                messages={messages}
                runObjective={liveView?.objective ?? null}
                streamingId={streamingId}
                runSlot={
                  liveView ? (
                    <RunCard
                      view={liveView}
                      resumed={resumed}
                      onRefresh={refresh}
                      onOpenWorkbench={() => setWorkbenchOpen(true)}
                    />
                  ) : running ? (
                    <p className="run-now subtle" role="status">
                      Starting…
                    </p>
                  ) : null
                }
              />
            )}
            <div ref={streamEnd} />
          </div>
        </div>
        <Composer
          ref={composer}
          value={objective}
          onChange={setObjective}
          onSubmit={() => void runObjective(objective)}
          attachments={attachments}
          uploading={uploading}
          onAttach={(file) => void attachFile(file)}
          onRemoveAttachment={(id) => void removeAttachment(id)}
          onCancel={() => void cancel()}
          onRetry={
            failedObjective
              ? () => {
                  const value = failedObjective;
                  setMessages((current) =>
                    current.filter(
                      (message) =>
                        !(
                          message.id.startsWith("pending:") &&
                          message.content === value
                        ),
                    ),
                  );
                  void runObjective(value);
                }
              : null
          }
          onRegenerate={
            lastObjective && !empty
              ? () => void runObjective(lastObjective, true)
              : null
          }
          running={running}
          cancelling={cancelling}
          error={error}
          workspaceName={props.workspaceName}
          github={github}
          approvalAnchor={
            pendingApproval ? `approval-${pendingApproval.id}` : null
          }
        />
        <p className="sr-only" role="status" aria-live="polite">
          {liveStatus}
        </p>
      </div>
      <Workbench
        open={open}
        onOpenChange={setWorkbenchOpen}
        snapshot={snapshot}
        view={liveView}
        tab={activeTab}
        onTab={setTab}
        onRefresh={refresh}
        width={width}
        onWidth={setWidth}
      />
    </div>
  );
}
