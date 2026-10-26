"use client";

import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Copy,
  RotateCcw,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Markdown } from "../chat/markdown";
import { useShell, type SessionSummary } from "../shell/shell-context";
import { notifyUsage } from "../motion/quota-bars";
import { OsirusMark } from "../shell/osirus-mark";
import { TopBar } from "../shell/top-bar";
import { cx } from "../ui/cx";
import { readChatStream } from "./sse";

export type AgentsChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  reasoning?: string | null;
  botId?: string | null;
  partial?: boolean;
};

type UiMessage = AgentsChatMessage & {
  streaming?: boolean;
  error?: string | null;
  thinkingStartedAt?: number | null;
  thinkingMs?: number | null;
};

export type AgentsBot = { id: string; name: string };

type Thread = {
  sessionId: string;
  title: string;
  messages: AgentsChatMessage[];
};

const SUGGESTIONS = [
  "Erkläre mir ein Konzept so, dass ich es in 5 Minuten verstehe",
  "Schreibe eine präzise E-Mail an einen Kunden",
  "Vergleiche zwei Technologien als Tabelle",
  "Prüfe meinen Code auf Fehler",
];

const subscribeNever = () => () => undefined;
const localHour = () => new Date().getHours();
const serverHour = () => null;

function greeting(name: string | null, hour: number | null) {
  if (hour === null) return name ? `Hallo, ${name}` : "Hallo";
  const part =
    hour < 5
      ? "Gute Nacht"
      : hour < 11
        ? "Guten Morgen"
        : hour < 18
          ? "Guten Tag"
          : "Guten Abend";
  return name ? `${part}, ${name}` : part;
}

function seconds(ms: number) {
  return Math.max(1, Math.round(ms / 1000));
}

function errorText(
  status: number,
  body: { message?: string; error?: string } | null,
) {
  if (body?.message) return body.message;
  switch (body?.error) {
    case "rate_limited":
      return "Zu viele Nachrichten in kurzer Zeit. Bitte einen Moment warten.";
    case "unauthorized":
      return "Deine Sitzung ist abgelaufen. Bitte neu anmelden.";
    case "invalid_request":
      return "Die Nachricht konnte nicht gesendet werden.";
    default:
      return status >= 500
        ? "Osirus ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen."
        : "Die Nachricht konnte nicht gesendet werden.";
  }
}

const Thinking = memo(function Thinking(props: {
  text: string;
  live: boolean;
  startedAt: number | null;
  doneMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [props.live]);
  const elapsed = props.live
    ? props.startedAt
      ? now - props.startedAt
      : 0
    : (props.doneMs ?? 0);
  const label = props.live
    ? `Denkt nach${elapsed > 1500 ? ` · ${seconds(elapsed)} s` : ""}`
    : props.doneMs
      ? `Gedacht für ${seconds(props.doneMs)} s`
      : "Gedankengang";
  return (
    <div className={cx("ac-think", props.live && "ac-think-live")}>
      <button
        type="button"
        className="ac-think-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cx("ac-think-chevron", open && "ac-think-chevron-open")}
        />
        <span className={cx(props.live && "ac-shimmer")}>{label}</span>
      </button>
      {open ? <div className="ac-think-body">{props.text}</div> : null}
    </div>
  );
});

const MessageView = memo(function MessageView(props: {
  message: UiMessage;
  botName: string | null;
  isLast: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onHandoff: (text: string) => void;
}) {
  const { message } = props;
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="ac-row ac-row-user">
        <div className="ac-user">{message.content}</div>
      </div>
    );
  }
  const waiting = message.streaming && !message.content && !message.reasoning;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ac-row ac-row-assistant">
      <div className="ac-avatar" aria-hidden="true">
        {props.botName ? <Bot size={16} /> : <OsirusMark />}
      </div>
      <div className="ac-assistant">
        {props.botName ? <p className="ac-bot-name">{props.botName}</p> : null}
        {message.reasoning ? (
          <Thinking
            text={message.reasoning}
            live={Boolean(message.streaming && !message.content)}
            startedAt={message.thinkingStartedAt ?? null}
            doneMs={message.thinkingMs ?? null}
          />
        ) : null}
        {waiting ? (
          <div
            className="ac-waiting"
            role="status"
            aria-label="Osirus schreibt"
          >
            <i />
            <i />
            <i />
          </div>
        ) : null}
        {message.content ? (
          <div
            className={cx(
              "ac-answer",
              message.streaming && "ac-answer-streaming",
            )}
          >
            <Markdown content={message.content} />
          </div>
        ) : null}
        {message.error ? (
          <div className="ac-error" role="alert">
            <p>{message.error}</p>
            {props.isLast && !props.busy ? (
              <button
                type="button"
                className="ac-error-retry"
                onClick={props.onRegenerate}
              >
                <RotateCcw size={14} aria-hidden="true" /> Erneut versuchen
              </button>
            ) : null}
          </div>
        ) : null}
        {!message.streaming && message.content ? (
          <div className="ac-actions">
            <button
              type="button"
              className="ac-action"
              onClick={() => void copy()}
              aria-label="Antwort kopieren"
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              <span>{copied ? "Kopiert" : "Kopieren"}</span>
            </button>
            {props.isLast ? (
              <button
                type="button"
                className="ac-action"
                onClick={props.onRegenerate}
                disabled={props.busy}
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Neu</span>
              </button>
            ) : null}
            <button
              type="button"
              className="ac-action"
              onClick={() => props.onHandoff(message.content)}
              title="Als Auftrag an den Rouge Agent übergeben"
            >
              <Zap size={14} aria-hidden="true" />
              <span>Rouge Agent</span>
            </button>
            {message.partial ? (
              <span className="ac-model-tag">abgebrochen</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function AgentsChat(props: {
  initialThread: Thread | null;
  bots: AgentsBot[];
  greetingName: string | null;
  initialBotId?: string | null;
  initialPrompt?: string | null;
}) {
  const { bindChat, upsertSession } = useShell();
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(
    props.initialThread?.sessionId ?? null,
  );
  const [messages, setMessages] = useState<UiMessage[]>(
    props.initialThread?.messages ?? [],
  );
  const [title, setTitle] = useState<string | null>(
    props.initialThread?.title ?? null,
  );
  const [input, setInput] = useState(props.initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [botId, setBotId] = useState<string | null>(
    props.bots.some((bot) => bot.id === props.initialBotId)
      ? (props.initialBotId ?? null)
      : null,
  );
  const [atBottom, setAtBottom] = useState(true);
  // The greeting follows the reader's clock, known only after hydration.
  const hour = useSyncExternalStore(subscribeNever, localHour, serverHour);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickRef = useRef(true);

  const botsById = useMemo(
    () => new Map(props.bots.map((bot) => [bot.id, bot])),
    [props.bots],
  );
  const activeBot = botId ? (botsById.get(botId) ?? null) : null;

  // Keep the newest text in view while it streams, unless the reader scrolled up.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const near =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    stickRef.current = near;
    setAtBottom(near);
  };

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [input]);

  const resetThread = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setTitle(null);
    setInput("");
    setBusy(false);
    window.history.replaceState(null, "", "/app");
    textareaRef.current?.focus();
  }, []);

  const openThread = useCallback(
    async (session: SessionSummary) => {
      if (
        session.surface &&
        session.surface !== "ai" &&
        session.surface !== "bot"
      ) {
        router.push(
          `${session.surface === "coding" ? "/app/coding" : "/app/agent"}?session=${session.id}` as Route,
        );
        return;
      }
      abortRef.current?.abort();
      setBusy(false);
      setSessionId(session.id);
      setMessages([]);
      setTitle(session.title);
      window.history.replaceState(null, "", `/app?session=${session.id}`);
      const response = await fetch(`/api/chat/threads/${session.id}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) {
        setMessages([
          {
            id: "missing",
            role: "assistant",
            content: "",
            error: "Dieser Chat konnte nicht geladen werden.",
          },
        ]);
        return;
      }
      const thread = (await response.json()) as Thread;
      stickRef.current = true;
      setMessages(thread.messages);
    },
    [router],
  );

  useEffect(() => {
    bindChat({
      activeSessionId: sessionId,
      running: busy,
      select: (session) => void openThread(session),
      newTask: resetThread,
    });
  }, [bindChat, busy, openThread, resetThread, sessionId]);

  useEffect(() => () => bindChat(null), [bindChat]);

  useEffect(() => {
    if (!props.initialThread) textareaRef.current?.focus();
  }, [props.initialThread]);

  const send = useCallback(
    async (text: string, options: { regenerate?: boolean } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      // "@Botname message" talks to that bot for this message.
      let targetBot = botId;
      let content = trimmed;
      const mention = trimmed.match(/^@([^\s].{0,79}?)\s+([\s\S]+)$/);
      if (mention) {
        const hit = props.bots.find(
          (bot) => mention[1].toLowerCase() === bot.name.toLowerCase(),
        );
        if (hit) {
          targetBot = hit.id;
          content = mention[2];
        }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      stickRef.current = true;
      const assistantId = `pending-${Date.now()}`;
      setMessages((current) => {
        const last = current[current.length - 1];
        const base = options.regenerate
          ? last?.role === "assistant"
            ? current.slice(0, -1)
            : current
          : [
              ...current,
              {
                id: `user-${Date.now()}`,
                role: "user" as const,
                content: trimmed,
              },
            ];
        return [
          ...base,
          {
            id: assistantId,
            role: "assistant" as const,
            content: "",
            streaming: true,
            botId: targetBot,
          },
        ];
      });
      if (!options.regenerate) setInput("");

      const patch = (update: (message: UiMessage) => UiMessage) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? update(message) : message,
          ),
        );

      let answer = "";
      let reasoning = "";
      let thinkingStartedAt: number | null = null;
      let thinkingMs: number | null = null;
      let frame = 0;
      const flush = () => {
        frame = 0;
        const snapshotText = answer;
        const snapshotReasoning = reasoning;
        const snapshotThinking = thinkingMs;
        patch((message) => ({
          ...message,
          content: snapshotText,
          reasoning: snapshotReasoning || null,
          thinkingStartedAt,
          thinkingMs: snapshotThinking,
        }));
      };
      const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(flush);
      };

      let settled = false;
      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: content,
            botId: targetBot,
            regenerate: Boolean(options.regenerate),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
            error?: string;
          } | null;
          patch((message) => ({
            ...message,
            streaming: false,
            error: errorText(response.status, body),
          }));
          return;
        }
        for await (const event of readChatStream(response)) {
          if (event.type === "start") {
            setSessionId(event.sessionId);
            setTitle(event.title);
            if (event.created) {
              window.history.replaceState(
                null,
                "",
                `/app?session=${event.sessionId}`,
              );
            }
            upsertSession({
              id: event.sessionId,
              title: event.title,
              updatedAt: new Date().toISOString(),
              surface: targetBot ? "bot" : "ai",
            });
          } else if (event.type === "reset") {
            reasoning = "";
            answer = "";
            thinkingStartedAt = null;
            schedule();
          } else if (event.type === "reasoning") {
            if (thinkingStartedAt === null) thinkingStartedAt = Date.now();
            reasoning += event.text;
            schedule();
          } else if (event.type === "text") {
            if (thinkingStartedAt !== null && thinkingMs === null) {
              thinkingMs = Date.now() - thinkingStartedAt;
            }
            answer += event.text;
            schedule();
          } else if (event.type === "error") {
            settled = true;
            if (frame) window.cancelAnimationFrame(frame);
            flush();
            patch((message) => ({
              ...message,
              streaming: false,
              error: event.message,
            }));
          } else if (event.type === "done") {
            settled = true;
            if (frame) window.cancelAnimationFrame(frame);
            flush();
            const doneAt = Date.now();
            patch((message) => ({
              ...message,
              id: event.messageId ?? message.id,
              streaming: false,
              thinkingMs:
                thinkingMs ??
                (thinkingStartedAt ? doneAt - thinkingStartedAt : null),
            }));
          }
        }
        if (!settled && !controller.signal.aborted) {
          if (frame) window.cancelAnimationFrame(frame);
          flush();
          patch((message) => ({
            ...message,
            streaming: false,
            partial: Boolean(message.content),
            error: "Die Antwort brach vorzeitig ab. Bitte noch einmal senden.",
          }));
        }
      } catch {
        if (frame) window.cancelAnimationFrame(frame);
        flush();
        patch((message) => ({
          ...message,
          streaming: false,
          partial: controller.signal.aborted ? true : message.partial,
          error: controller.signal.aborted
            ? null
            : "Die Verbindung wurde unterbrochen. Bitte noch einmal senden.",
        }));
      } finally {
        patch((message) =>
          message.streaming ? { ...message, streaming: false } : message,
        );
        setBusy(false);
        abortRef.current = null;
        notifyUsage();
      }
    },
    [botId, busy, props.bots, sessionId, upsertSession],
  );

  const stop = () => abortRef.current?.abort();

  const regenerate = () => {
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    if (lastUser) void send(lastUser.content, { regenerate: true });
  };

  const handoff = (answer: string) => {
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const prompt = [
      lastUser ? `Aufgabe: ${lastUser.content}` : "",
      `Kontext aus dem Chat:\n${answer}`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);
    router.push(
      `/app/agent?new=1&prompt=${encodeURIComponent(prompt)}` as Route,
    );
  };

  const empty = messages.length === 0;
  const lastIndex = messages.length - 1;

  const composer = (
    <form
      className={cx("ac-composer", busy && "ac-composer-busy")}
      onSubmit={(event) => {
        event.preventDefault();
        void send(input);
      }}
    >
      {activeBot ? (
        <div className="ac-bot-active">
          <Bot size={14} aria-hidden="true" />
          <span>
            Mit <strong>{activeBot.name}</strong>
          </span>
          <button
            type="button"
            className="ac-bot-clear"
            onClick={() => setBotId(null)}
            aria-label="Bot abwählen"
          >
            ×
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="ac-input"
        value={input}
        rows={1}
        placeholder={
          activeBot
            ? `Nachricht an ${activeBot.name}`
            : "Frag Osirus irgendetwas …"
        }
        aria-label="Nachricht"
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void send(input);
          }
          if (event.key === "Escape" && busy) {
            event.preventDefault();
            stop();
          }
        }}
      />
      <div className="ac-composer-bar">
        <span
          className="ac-auto"
          title="Osirus wählt für jede Aufgabe das passende Modell"
        >
          <Sparkles size={13} aria-hidden="true" />
          {activeBot ? activeBot.name : "Auto"}
        </span>
        <span className="ac-composer-spacer" />
        {busy ? (
          <button
            type="button"
            className="ac-send ac-send-stop"
            onClick={stop}
            aria-label="Antwort stoppen"
          >
            <Square size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="ac-send"
            disabled={!input.trim()}
            aria-label="Senden"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className={cx("ac", empty && "ac-empty")}>
      <TopBar title={title ?? "Agents"} titleAs="p" />
      <div className="ac-scroll" ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          <div className="ac-hero">
            <div className="ac-hero-mark" aria-hidden="true">
              <OsirusMark />
            </div>
            <h1 className="ac-hero-title">
              {greeting(props.greetingName, hour)}
            </h1>
            <p className="ac-hero-sub">Was kann ich für dich tun?</p>
            {composer}
            <div className="ac-suggestions">
              {SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  className="ac-chip"
                  style={{ ["--d" as string]: `${index * 50}ms` }}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {props.bots.length ? (
              <div className="ac-bots" aria-label="Deine Bots">
                {props.bots.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    className={cx(
                      "ac-bot-chip",
                      bot.id === botId && "ac-bot-chip-on",
                    )}
                    aria-pressed={bot.id === botId}
                    onClick={() => setBotId(bot.id === botId ? null : bot.id)}
                  >
                    <Bot size={14} aria-hidden="true" /> {bot.name}
                  </button>
                ))}
                <Link
                  href={"/app/agents" as Route}
                  className="ac-bot-chip ac-bot-chip-ghost"
                >
                  Bots verwalten
                </Link>
              </div>
            ) : (
              <Link href={"/app/agents" as Route} className="ac-bots-hint">
                <Bot size={14} aria-hidden="true" /> Eigenen Bot mit Rolle und
                Persona anlegen
              </Link>
            )}
          </div>
        ) : (
          <div className="ac-thread" aria-live="polite">
            {messages.map((message, index) => (
              <MessageView
                key={message.id}
                message={message}
                botName={
                  message.botId
                    ? (botsById.get(message.botId)?.name ?? "Bot")
                    : null
                }
                isLast={index === lastIndex}
                busy={busy}
                onRegenerate={regenerate}
                onHandoff={handoff}
              />
            ))}
          </div>
        )}
      </div>
      {empty ? null : (
        <div className="ac-dock">
          {!atBottom ? (
            <button
              type="button"
              className="ac-jump"
              onClick={scrollToBottom}
              aria-label="Zum Ende springen"
            >
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          ) : null}
          {composer}
          <p className="ac-footnote">
            Osirus kann Fehler machen. Wichtige Ergebnisse prüfen.
          </p>
        </div>
      )}
    </div>
  );
}
