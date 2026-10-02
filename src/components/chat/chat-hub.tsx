"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ModelCallSummary, RunSnapshot, RuntimePacket } from "@/lib/runtime/types";
import { repositoryInObjective } from "@/lib/coding/repository-ref";
import { rougeErrorMessage } from "@/lib/rouge/errors";
import type { RougeResponse, RougeStreamEvent } from "@/lib/rouge/types";
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
  parseLabModel,
  type InteractionPreference,
  type LabModelId,
} from "@/lib/lab/choices";
import { aiConversation } from "@/lib/ui/ai-turn";
import { createSnapshotGate, deriveRunView, TERMINAL } from "@/lib/ui/run-view";
import { useShell } from "../shell/shell-context";
import {
  Composer,
  type ComposerAttachment,
  type ComposerHandle,
} from "../composer/composer";
import { MessageList, type ChatMessage } from "./message-list";
import { RunCard } from "../run-status/run-card";

const terminalStatuses = TERMINAL;

function titleFor(objective: string): string {
  const short = objective.trim().replace(/\s+/g, " ");
  return short.length > 60 ? `${short.slice(0, 57)}…` : short;
}

export type SessionState = {
  sessionId: string;
  activeRunId: string | null;
  recentRunId: string | null;
  messages: ChatMessage[];
  modelCalls: Record<string, ModelCallSummary>;
};

type GithubStatus =
  | { status: "loading" }
  | { status: "CONNECTED"; login: string }
  | { status: "NOT_CONNECTED" | "NOT_CONFIGURED" | "unknown" };

/**
 * The chat itself: message flow, the live run, and the composer. Runs are
 * server-side; this page streams their progress, keeps the visible state
 * tied to the run that is actually shown, and reconnects after a reload.
 */
export function ChatHub(props: {
  workspaceId: string;
  workspaceName: string;
  githubStatus: string;
  githubLogin: string | null;
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  initialModelCalls?: Record<string, ModelCallSummary>;
  initialRunId: string | null;
  initialSnapshot: RunSnapshot | null;
  initialSnapshotRunId: string | null;
}) {
  const shell = useShell();
  const [sessionId, setSessionId] = useState<string | null>(
    props.initialSessionId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    props.initialMessages,
  );
  const [modelCalls, setModelCalls] = useState<
    Record<string, ModelCallSummary>
  >(props.initialModelCalls ?? {});
  const [objective, setObjective] = useState("");
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(
    props.initialSnapshot,
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(
    props.initialRunId,
  );
  const [running, setRunning] = useState(!!props.initialRunId);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedObjective, setFailedObjective] = useState<string | null>(null);
  const [lastObjective, setLastObjective] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [activities, setActivities] = useState<
    { id: string; label: string; at: string }[] >([]);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  /** Message id of the AI-mode answer while it streams; null otherwise. */
  const [aiStreamId, setAiStreamId] = useState<string | null>(null);
  const [github, setGithub] = useState<GithubStatus>(() =>
    props.githubStatus === "CONNECTED" && props.githubLogin
      ? { status: "CONNECTED", login: props.githubLogin }
      : props.githubStatus === "NOT_CONNECTED" ||
          props.githubStatus === "NOT_CONFIGURED"
        ? { status: props.githubStatus }
        : { status: "unknown" },
  );

  const composer = useRef<ComposerHandle | null>(null);
  const scrollNode = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const githubRequested = useRef(false);
  // Only this run's snapshots may drive the view. A poll answers seconds
  // late; without the gate it could paint a run this page no longer shows
  // over the current conversation.
  const [snapshotGate] = useState(() =>
    createSnapshotGate(props.initialRunId ?? props.initialSnapshotRunId),
  );
  const streamAbort = useRef<AbortController | null>(null);

  const applySnapshot = useCallback(
    (next: RunSnapshot) => {
      // Late answer from a run this page no longer shows: drop it.
      if (!snapshotGate.accepts(next.run.id)) return;
      setSnapshot(next);
      setSessionId(next.run.sessionId);
      setActiveRunId(
        terminalStatuses.has(next.run.status) ? null : next.run.id,
      );
      setRunning(!terminalStatuses.has(next.run.status));
      if (terminalStatuses.has(next.run.status)) setCancelling(false);
      setMessages(next.messages);
      // A snapshot only knows its own session's calls; keep what earlier
      // snapshots already told us about other runs in this conversation.
      if (next.modelCalls) {
        setModelCalls((current) => ({ ...current, ...next.modelCalls }));
      }
      setActivities(
        next.events
          .filter((event) => event.visibility === "user")
          .map((event) => ({
            id: event.id,
            label: event.summary,
            at: event.at,
          })),
      );
    },
    [snapshotGate],
  );

  const refreshRun = useCallback(
    async (runId: string) => {
      const response = await fetch(`/api/runtime/${runId}`);
      if (response.status === 404) {
        setActiveRunId((current) => (current === runId ? null : current));
        setRunning(false);
        return;
      }
      if (!response.ok) return;
      applySnapshot((await response.json()) as RunSnapshot);
    },
    [applySnapshot],
  );

  const applyPacket = useCallback(
    (packet: RuntimePacket) => {
      switch (packet.type) {
        case "started":
          snapshotGate.expect(packet.runId);
          setActiveRunId(packet.runId);
          setSessionId(packet.sessionId);
          return;
        case "delta":
          setMessages((current) => {
            const last = current.at(-1);
            const streamId = `stream:${packet.runId}`;
            if (last?.id === streamId) {
              return [
                ...current.slice(0, -1),
                { ...last, content: last.content + packet.text },
              ];
            }
            return [
              ...current,
              { id: streamId, role: "assistant", content: packet.text },
            ];
          });
          return;
        case "stage":
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  stages: [
                    ...current.stages.filter((row) => row.id !== packet.stage.id),
                    packet.stage,
                  ],
                }
              : current,
          );
          return;
        case "event":
          if (packet.event.visibility === "user") {
            setActivities((current) => [
              ...current.slice(-40),
              {
                id: packet.event.id,
                label: packet.event.summary,
                at: packet.event.at,
              },
            ]);
          }
          void refreshRun(packet.event.runId);
          return;
        case "snapshot":
          applySnapshot(packet.snapshot);
          return;
        case "done": {
          const finished = terminalStatuses.has(packet.status);
          setActiveRunId(finished ? null : packet.runId);
          setRunning(!finished);
          if (finished) setCancelling(false);
          void refreshRun(packet.runId);
          return;
        }
        case "error":
          setError(packet.message);
          setRunning(false);
          return;
      }
    },
    [applySnapshot, refreshRun, snapshotGate],
  );

  const attachFile = useCallback(
    async (file: File) => {
      if (!sessionId) {
        setError("Send a message first, then attach files to the chat.");
        return;
      }
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/sessions/${sessionId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        setError("The file could not be attached.");
      }
    },
    [sessionId],
  );

  const runObjective = useCallback(
    async (value: string, regenerate = false) => {
      const trimmed = value.trim();
      if (!trimmed || running) return;

      if (interaction === "ai" && !regenerate) {
        // AI mode: one direct, streamed answer from the Rouge runtime
        // (/api/rouge) -- no run, no tool stages, no approvals. That is the
        // difference to Agent mode, and it is a real one.
        const requestId = crypto.randomUUID();
        const streamId = `stream:${requestId}`;
        const history = aiConversation(messages, trimmed);
        setObjective("");
        setError(null);
        setFailedObjective(null);
        setAiStatus("Thinking");
        setAiStreamId(streamId);
        setMessages((current) => [
          ...current,
          { id: `pending:${requestId}`, role: "user", content: trimmed },
        ]);
        try {
          const response = await fetch("/api/rouge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId, messages: history }),
          });
          if (!response.ok || !response.body) {
            const body = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(rougeErrorMessage(body.error ?? "rouge_failed"));
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let final: RougeResponse | null = null;
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
                if (!payload) continue;
                const event = JSON.parse(payload) as
                  | RougeStreamEvent
                  | { type: "error"; code?: string; message?: string };
                if (event.type === "status") {
                  setAiStatus(event.label);
                } else if (event.type === "delta") {
                  setMessages((current) => {
                    const last = current.at(-1);
                    if (last?.id === streamId) {
                      return [
                        ...current.slice(0, -1),
                        { ...last, content: last.content + event.text },
                      ];
                    }
                    return [
                      ...current,
                      {
                        id: streamId,
                        role: "assistant",
                        content: event.text,
                      },
                    ];
                  });
                } else if (event.type === "done") {
                  final = event.response;
                } else if (event.type === "error") {
                  throw new Error(
                    event.message ??
                      rougeErrorMessage(event.code ?? "rouge_failed"),
                  );
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
          if (!final) throw new Error(rougeErrorMessage("empty_answer"));
          const answer: RougeResponse = final;
          setMessages((current) => {
            const answered: ChatMessage = {
              id: streamId,
              role: "assistant",
              content: answer.text,
              // Which model actually served -- including a substitute -- and
              // what it spent. Details on the message carry it.
              modelCall: {
                model: answer.core.served,
                latencyMs: answer.latencyMs,
                inputTokens: answer.usage.inputTokens,
                outputTokens: answer.usage.outputTokens,
              },
            };
            return current.some((message) => message.id === streamId)
              ? current.map((message) =>
                  message.id === streamId ? answered : message,
                )
              : [...current, answered];
          });
        } catch (requestError) {
          // Keep a partial answer; drop only a stream row that never wrote.
          setMessages((current) =>
            current.filter(
              (message) => message.id !== streamId || message.content,
            ),
          );
          setError(
            requestError instanceof Error
              ? requestError.message
              : rougeErrorMessage("rouge_failed"),
          );
        } finally {
          setAiStatus(null);
          setAiStreamId(null);
        }
        return;
      }

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
      // Close the gate until the new run announces itself: a late snapshot
      // of the previous run must not overwrite this run's fresh start.
      snapshotGate.expect(null);

      const repository = repositoryInObjective(trimmed);
      if (repository && !githubRequested.current) {
        githubRequested.current = true;
        fetch("/api/github/status")
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (!body) return;
            setGithub(
              body.status === "CONNECTED"
                ? { status: "CONNECTED", login: body.login }
                : { status: body.status },
            );
          })
          .catch(() => undefined);
      }

      setMessages((current) => [
        ...current,
        { id: `pending:${requestId}`, role: "user", content: trimmed },
      ]);
      setLastObjective(trimmed);

      let startedRunId: string | null = null;
      try {
        const response = await fetch("/api/runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: trimmed,
            requestId,
            sessionId: sessionId ?? undefined,
            regenerate,
            mode,
          }),
        });
        const headerRun = response.headers.get("x-osirus-run");
        const headerSession = response.headers.get("x-osirus-session");
        if (headerSession) setSessionId(headerSession);
        if (headerRun) {
          startedRunId = headerRun;
          snapshotGate.expect(headerRun);
          setActiveRunId(headerRun);
        }

        if (response.status === 429) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setRunning(false);
          setFailedObjective(trimmed);
          setError(body.error ?? "That is too many runs at once.");
          return;
        }
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setRunning(false);
          setFailedObjective(trimmed);
          setError(body.error ?? "The run could not be started.");
          return;
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
              if (!payload) continue;
              try {
                applyPacket(JSON.parse(payload) as RuntimePacket);
              } catch {
                // Ignore malformed packets.
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch {
        setRunning(false);
        setFailedObjective(trimmed);
        setError("The connection dropped. The run may still be working.");
        if (startedRunId) void refreshRun(startedRunId);
      }
    },
    [
      applyPacket,
      interaction,
      messages,
      mode,
      refreshRun,
      running,
      sessionId,
      snapshotGate,
    ],
  );

  const cancel = useCallback(async () => {
    if (!activeRunId) return;
    setCancelling(true);
    const runId = activeRunId;
    const response = await fetch(`/api/runtime/${runId}/cancel`, {
      method: "POST",
    }).catch(() => null);
    if (!response || !response.ok) {
      setCancelling(false);
      setError("The run could not be cancelled.");
      return;
    }
    window.setTimeout(() => void refreshRun(runId), 500);
  }, [activeRunId, refreshRun]);

  const newTask = useCallback(() => {
    if (running) return;
    setError(null);
    setFailedObjective(null);
    setSessionId(null);
    setMessages([]);
    setModelCalls({});
    setActiveRunId(null);
    setActivities([]);
    setSnapshot(null);
    setResumed(false);
    setWorkbenchOpen(null);
    snapshotGate.expect(null);
    window.history.replaceState(null, "", "/app?new=1");
    window.setTimeout(() => composer.current?.focus(), 0);
  }, [running, snapshotGate]);

  const switchSession = useCallback(
    async (next: string) => {
      if (running || next === sessionId) return;
      const response = await fetch(`/api/sessions/${next}`);
      if (!response.ok) return;
      const state = (await response.json()) as SessionState;
      // Commit the gate before the refresh below: only this session's run
      // may paint over the conversation from now on.
      snapshotGate.expect(state.activeRunId ?? state.recentRunId);
      setSessionId(state.sessionId);
      setMessages(state.messages);
      setModelCalls(state.modelCalls);
      setActiveRunId(state.activeRunId);
      setSnapshot(null);
      setActivities([]);
      setResumed(true);
      setWorkbenchOpen(null);
      setTab(null);
      setError(null);
      setFailedObjective(null);
      window.history.replaceState(null, "", `/app?session=${state.sessionId}`);
      if (state.recentRunId) void refreshRun(state.recentRunId);
    },
    [refreshRun, running, sessionId, snapshotGate],
  );

  useEffect(() => {
    if (props.initialRunId ?? props.initialSnapshotRunId) {
      void refreshRun(props.initialRunId ?? props.initialSnapshotRunId!);
    }
    // The initial state arrives with the page; one refresh catches up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeRunId || running || streaming) return;
    const interval = window.setInterval(() => void refreshRun(activeRunId), 2000);
    return () => window.clearInterval(interval);
  }, [activeRunId, running, streaming, refreshRun]);

  return <></>;
}
