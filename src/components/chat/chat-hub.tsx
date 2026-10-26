"use client";

import { PanelRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  ModelCallSummary,
  RunSnapshot,
  RuntimePacket,
} from "@/lib/runtime/types";
import {
  INTERACTION_COOKIE,
  LAB_MODEL_COOKIE,
  MODE_COOKIE,
  parseMode,
  readPreference,
  writePreference,
  type ModePreference,
} from "@/lib/ui/preferences";
import {
  parseInteraction,
  type InteractionPreference,
} from "@/lib/lab/choices";
import { DEFAULT_PRODUCT_MODEL_ID } from "@/config/recommendations";
import { productModelOrDefault } from "@/lib/models/allowlist";
import { isSessionId, shouldApplyRunSnapshot } from "@/lib/ui/snapshot-gate";
import { chatRunPresentation, chatStatusLine } from "@/lib/ui/chat-status";
import { liveAgentPills, showWorkingMotion } from "@/lib/ui/live-activity";
import { chatSlash } from "@/lib/coding/intent";
import { botRuntimeBody } from "@/lib/product/bot-run";
import {
  draftAfterSurfaceChange,
  type SessionSurface,
} from "@/lib/product/surfaces";
import { FreeQuotaPanel } from "../settings/plan-offer";
import { WorkingMotion } from "./working-motion";
import { deriveRunView, TERMINAL } from "@/lib/ui/run-view";
import {
  autoOpenWorkbench,
  defaultTab,
  type WorkbenchTab,
} from "@/lib/ui/workbench-view";
import {
  Composer,
  type ComposerAttachment,
  type ComposerHandle,
} from "../composer/composer";
import { RunCard } from "../run-status/run-card";
import { notifyUsage } from "../motion/quota-bars";
import { useShell, type SessionSummary } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/icon-button";
import { useWideLayout, Workbench } from "../workbench/workbench";
import { ChatHome } from "./chat-home";
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
  surface?: SessionSurface | null;
  messages: ChatMessage[];
  modelCalls?: Record<string, ModelCallSummary>;
  activeRunId: string | null;
  recentRunId: string | null;
};

const terminalStatuses = TERMINAL;

// The working mode persists per browser in a preference cookie. Exposed as
// an external store so the cookie is read only after hydration -- the server
// snapshot keeps SSR and the first client render on "auto" -- and so picking
// a mode notifies the composer immediately.
const modeListeners = new Set<() => void>();

function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

function currentMode(): ModePreference {
  return parseMode(readPreference(MODE_COOKIE));
}

function serverMode(): ModePreference {
  return "auto";
}

const labListeners = new Set<() => void>();

function subscribeLab(listener: () => void) {
  labListeners.add(listener);
  return () => {
    labListeners.delete(listener);
  };
}

function currentLabModel(): string {
  return productModelOrDefault(readPreference(LAB_MODEL_COOKIE));
}

function serverLabModel() {
  return DEFAULT_PRODUCT_MODEL_ID;
}

function currentInteraction(): InteractionPreference {
  return parseInteraction(readPreference(INTERACTION_COOKIE));
}

function serverInteraction(): InteractionPreference {
  return "agent";
}

export function ChatHub(props: {
  workspaceName: string;
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  initialRunId: string | null;
  initialSnapshotRunId: string | null;
  /** Server-provided snapshot, so the first paint already shows the run. */
  initialSnapshot?: RunSnapshot | null;
  /**
   * Visual fixtures only. Live product chat leaves this unset so a running
   * task stays one status line. The approval screenshots keep their old layout.
   */
  screenshotLayout?: boolean;
  /**
   * ai and agent are separate routes. Fixtures omit this and keep the
   * previous chrome so the phone composer layout stays put.
   */
  kind?: "ai" | "agent" | "bot";
  /** Set by the chat page when the free tier is on and its quota is empty. */
  freeQuotaEmpty?: boolean;
  /** When the spent free quota refills (ISO), if known. */
  freeQuotaAvailableAt?: string | null;
  /** Rouge Agent: the gateway model ("provider:model") the run is pinned to. */
  agentModelRef?: string | null;
  /** Shown above the composer (the Rouge Agent's model and options). */
  accessory?: ReactNode;
  /** Replaces the empty-state home. */
  emptySlot?: ReactNode;
  /** Puts text into the composer; a new nonce applies it again. */
  prefill?: { text: string; nonce: number } | null;
  /** The page title before the conversation has one. */
  titleFallback?: string;
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
  const [objective, setObjective] = useState(props.prefill?.text ?? "");
  // A new prefill (another nonce) replaces the draft once, during render.
  const [prefillApplied, setPrefillApplied] = useState(
    props.prefill?.nonce ?? null,
  );
  if (props.prefill && props.prefill.nonce !== prefillApplied) {
    setPrefillApplied(props.prefill.nonce);
    setObjective(props.prefill.text);
  }
  const surface: SessionSurface =
    props.kind === "agent" ? "agent" : props.kind === "bot" ? "bot" : "ai";
  const [seenSurface, setSeenSurface] = useState(surface);
  const threadPath =
    surface === "agent"
      ? "/app/agent"
      : surface === "bot"
        ? "/app/bots"
        : "/app";
  const mode = useSyncExternalStore(subscribeMode, currentMode, serverMode);
  const labModel = useSyncExternalStore(
    subscribeLab,
    currentLabModel,
    serverLabModel,
  );
  const interaction = useSyncExternalStore(
    subscribeLab,
    currentInteraction,
    serverInteraction,
  );
  const [labActivity, setLabActivity] = useState<string | null>(null);
  const [labPhases, setLabPhases] = useState<readonly string[]>([]);
  const [labGrades, setLabGrades] = useState<
    readonly { armId: string; phase: string | null; passed: boolean }[]
  >([]);
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
  // True while this page reads a run's event stream. The stream carries the
  // run's progress itself; polling alongside it would only replace the
  // streamed draft with the stored messages mid-answer.
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (seenSurface !== surface) {
    setSeenSurface(surface);
    setObjective(draftAfterSurfaceChange(seenSurface, surface, objective));
    setMessages(props.initialMessages);
    setSessionId(props.initialSessionId);
    setActiveRunId(props.initialRunId);
    setSnapshot(props.initialSnapshot ?? null);
    setError(null);
    setRunning(Boolean(props.initialRunId));
    setActivities([]);
  }
  const [failedObjective, setFailedObjective] = useState<string | null>(null);
  const [resumed, setResumed] = useState(
    Boolean(
      props.initialRunId ?? props.initialSnapshotRunId ?? props.initialSnapshot,
    ),
  );
  const [workbenchOpen, setWorkbenchOpen] = useState<boolean | null>(null);
  const [tab, setTab] = useState<WorkbenchTab | null>(null);
  const [width, setWidth] = useState(420);
  const streamAbort = useRef<AbortController | null>(null);
  const streamEnd = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const composer = useRef<ComposerHandle | null>(null);
  const wide = useWideLayout();
  // Bumped when the person leaves this conversation. A poll that started
  // earlier must not paint its snapshot over the one now on screen.
  const viewGeneration = useRef(0);
  const sessionRef = useRef(sessionId);
  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const advanceView = useCallback(() => {
    viewGeneration.current += 1;
  }, []);

  const selectMode = useCallback((next: ModePreference) => {
    writePreference(MODE_COOKIE, next);
    for (const listener of modeListeners) listener();
  }, []);

  const applySnapshot = useCallback((next: RunSnapshot) => {
    if (isSessionId(next.run.sessionId))
      sessionRef.current = next.run.sessionId;
    setSnapshot(next);
    setSessionId(next.run.sessionId);
    setActiveRunId(terminalStatuses.has(next.run.status) ? null : next.run.id);
    setRunning(!terminalStatuses.has(next.run.status));
    if (terminalStatuses.has(next.run.status)) {
      setCancelling(false);
      notifyUsage();
    }
    setMessages(next.messages);
    setActivities(
      next.events
        .filter((event) => event.visibility === "user")
        .map((event) => ({ id: event.id, label: event.summary, at: event.at })),
    );
  }, []);

  const refreshRun = useCallback(
    async (runId: string) => {
      const captured = viewGeneration.current;
      const response = await fetch(`/api/runtime/${runId}`, {
        cache: "no-store",
      }).catch(() => null);
      if (captured !== viewGeneration.current) return;
      if (response?.status === 404) {
        // Gone or not ours: stop polling it rather than ask forever.
        setActiveRunId((current) => (current === runId ? null : current));
        setRunning(false);
        return;
      }
      if (!response?.ok) return;
      const next = (await response.json()) as RunSnapshot;
      if (
        !shouldApplyRunSnapshot({
          capturedGeneration: captured,
          generation: viewGeneration.current,
          requestedRunId: runId,
          snapshotRunId: next.run.id,
          snapshotSessionId: next.run.sessionId,
          viewSessionId: sessionRef.current,
        })
      ) {
        return;
      }
      applySnapshot(next);
    },
    [applySnapshot],
  );

  useEffect(() => {
    const runId = props.initialRunId ?? props.initialSnapshotRunId;
    if (!runId) return;
    const initial = window.setTimeout(() => void refreshRun(runId), 0);
    return () => window.clearTimeout(initial);
  }, [props.initialRunId, props.initialSnapshotRunId, refreshRun]);

  // Every unfinished run this page shows is polled until it ends -- one that
  // was open when the page loaded, one picked from the sidebar, and one this
  // page started whose request ended before the run did. The poll is also
  // what resumes a run nobody is driving, so a run that is not polled can
  // stop halfway and never finish.
  useEffect(() => {
    if (!activeRunId || streaming) return;
    const runId = activeRunId;
    // One poll at a time: a slow answer must not stack requests behind it.
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void refreshRun(runId).finally(() => {
        inFlight = false;
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeRunId, streaming, refreshRun]);

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
                runId: packet.runId,
              },
            ];
          });
          return;
        case "done": {
          // `done` ends this request, not necessarily the run: a run that
          // outlives its request comes back `running` and continues in the
          // background. Keep it active so the poll above follows it.
          const finished = terminalStatuses.has(packet.status);
          setRunning(!finished);
          if (finished) setCancelling(false);
          setActiveRunId(finished ? null : packet.runId);
          void refreshRun(packet.runId);
          return;
        }
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
        const formData = new FormData();
        formData.append("file", file);
        if (sessionId) formData.append("sessionId", sessionId);
        const response = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
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
      advanceView();
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
      setStreaming(true);
      let startedRunId: string | null = null;
      try {
        const attachmentIds = regenerate
          ? []
          : attachments.map((attachment) => attachment.id);
        setAttachments([]);
        const response = await fetch("/api/runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            props.kind === "bot"
              ? botRuntimeBody({
                  objective: trimmed,
                  requestId,
                  sessionId,
                })
              : {
                  objective: trimmed,
                  requestId,
                  sessionId,
                  regenerate,
                  ...(props.kind === "agent"
                    ? {
                        mode: "agent" as const,
                        surface: "agent" as const,
                        ...(props.agentModelRef
                          ? { modelId: props.agentModelRef }
                          : {}),
                      }
                    : props.kind === "ai"
                      ? { surface: "ai" as const }
                      : {}),
                  ...(props.kind !== "agent" &&
                  props.kind !== "ai" &&
                  mode !== "auto"
                    ? { mode }
                    : {}),
                  ...(attachmentIds.length ? { attachmentIds } : {}),
                },
          ),
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
        if (isSessionId(headerSession)) {
          sessionRef.current = headerSession;
          setSessionId(headerSession);
          const existingSession = shell.sessions.find(
            (item) => item.id === headerSession,
          );
          upsertSession({
            id: headerSession,
            title: existingSession?.title ?? trimmed.slice(0, 120),
            updatedAt: new Date().toISOString(),
            pinnedAt: existingSession?.pinnedAt ?? null,
            surface,
          });
          window.history.replaceState(
            null,
            "",
            `${threadPath}?session=${headerSession}`,
          );
        }
        if (headerRun) {
          startedRunId = headerRun;
          setActiveRunId(headerRun);
        }

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
        if (startedRunId && !controller.signal.aborted) {
          // The connection dropped, not the run: it is durable and the poll
          // picks it up from here.
          void refreshRun(startedRunId);
        } else if (!controller.signal.aborted) {
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
        setStreaming(false);
      }
    },
    [
      applyPacket,
      attachments,
      advanceView,
      mode,
      refreshRun,
      running,
      sessionId,
      shell.sessions,
      upsertSession,
      props.kind,
      props.agentModelRef,
      surface,
      threadPath,
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
    advanceView();
    sessionRef.current = null;
    setError(null);
    setFailedObjective(null);
    setSessionId(null);
    setMessages([]);
    setActiveRunId(null);
    setActivities([]);
    setSnapshot(null);
    setResumed(false);
    setWorkbenchOpen(null);
    window.history.replaceState(null, "", `${threadPath}?new=1`);
    window.setTimeout(() => composer.current?.focus(), 0);
  }, [advanceView, running, threadPath]);

  const switchSession = useCallback(
    async (next: SessionSummary) => {
      if (running || next.id === sessionId) return;
      advanceView();
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
      if (!isSessionId(state.sessionId)) {
        setError("Could not load that conversation.");
        return;
      }
      if (state.surface && state.surface !== surface) {
        setError("That conversation belongs to another surface.");
        return;
      }
      sessionRef.current = state.sessionId;
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
      window.history.replaceState(
        null,
        "",
        `${threadPath}?session=${state.sessionId}`,
      );
      if (state.recentRunId) void refreshRun(state.recentRunId);
    },
    [advanceView, refreshRun, running, sessionId, surface, threadPath],
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

  const view = useMemo(
    () => (snapshot ? deriveRunView(snapshot) : null),
    [snapshot],
  );
  const livePills = useMemo(
    () => liveAgentPills({ interaction, snapshot }),
    [interaction, snapshot],
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
    (messages.length
      ? "Conversation"
      : props.kind === "agent"
        ? (props.titleFallback ?? "Agent")
        : props.kind === "bot"
          ? "Bot"
          : props.kind === "ai"
            ? "Chat"
            : "New task");
  const empty = messages.length === 0 && !running;
  const pendingApproval = liveView?.pendingApprovals[0];
  const productStatus = !(props.screenshotLayout && liveView?.live);
  const chatStatus =
    liveView && productStatus ? chatRunPresentation(liveView.status) : null;
  const liveStatus = chatStatus
    ? `${chatStatus.label}. ${chatStatusLine(liveView?.status, liveView?.failure?.message)}`
    : "";

  const refresh = useCallback(() => {
    if (snapshot) void refreshRun(snapshot.run.id);
  }, [refreshRun, snapshot]);

  return (
    <div
      className="chat-page"
      data-workbench={open && wide ? "open" : "closed"}
    >
      <div className="chat-column">
        <TopBar
          title={title}
          status={
            chatStatus ? (
              <Badge tone={chatStatus.tone}>{chatStatus.label}</Badge>
            ) : liveView ? (
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
            {props.freeQuotaEmpty ? (
              <FreeQuotaPanel
                availableAt={props.freeQuotaAvailableAt ?? null}
              />
            ) : null}
            {empty ? (
              props.kind === "bot" ? (
                <div className="home home-calm">
                  <p className="home-title">Bot</p>
                </div>
              ) : (
                (props.emptySlot ?? <ChatHome />)
              )
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
                      screenshotLayout={props.screenshotLayout}
                      onOpenWorkbench={() => setWorkbenchOpen(true)}
                    />
                  ) : running ? (
                    <p className="run-now subtle" role="status">
                      Starting
                    </p>
                  ) : null
                }
              />
            )}
            <WorkingMotion
              active={
                !props.screenshotLayout &&
                showWorkingMotion({
                  label:
                    chatStatus?.label ??
                    (running && !liveView ? "Starting" : null),
                  paused: Boolean(snapshot?.run.pausedAt),
                })
              }
            />
            <div ref={streamEnd} />
          </div>
        </div>
        {props.accessory}
        <Composer
          ref={composer}
          value={objective}
          onChange={setObjective}
          onSubmit={() => {
            const slash = chatSlash(objective);
            if (slash === "stop") {
              if (running) void cancel();
              setObjective("");
              return;
            }
            if (slash === "unknown") {
              setError("That is not a command.");
              setObjective("");
              return;
            }
            void runObjective(objective);
          }}
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
            props.kind === "ai" || !lastObjective || empty
              ? null
              : () => void runObjective(lastObjective, true)
          }
          running={running}
          cancelling={cancelling}
          error={error}
          workspaceName={props.workspaceName}
          mode={mode}
          onModeChange={selectMode}
          labModel={labModel}
          interaction={interaction}
          labActivity={
            interaction === "agent" && streaming ? "typing" : labActivity
          }
          labPhases={labPhases}
          labGrades={labGrades}
          livePills={livePills}
          onLabModelChange={(next) => {
            writePreference(LAB_MODEL_COOKIE, next);
            for (const listener of labListeners) listener();
          }}
          onInteractionChange={(next) => {
            writePreference(INTERACTION_COOKIE, next);
            setLabActivity(null);
            setLabPhases([]);
            setLabGrades([]);
            for (const listener of labListeners) listener();
          }}
          chrome={
            props.kind === "ai"
              ? "chat"
              : props.kind === "agent" || props.kind === "bot"
                ? "agent"
                : "full"
          }
          github={props.kind ? null : undefined}
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
        screenshotLayout={props.screenshotLayout}
        tab={activeTab}
        onTab={setTab}
        onRefresh={refresh}
        width={width}
        onWidth={setWidth}
      />
    </div>
  );
}
