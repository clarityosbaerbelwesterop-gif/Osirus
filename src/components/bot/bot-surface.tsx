"use client";

import { useState } from "react";
import { MessageList, type ChatMessage } from "../chat/message-list";
import { useShell } from "../shell/shell-context";
import { TopBar } from "../shell/top-bar";

/**
 * Bot is its own surface. Threads are saved. There is no second product
 * runtime behind them.
 */
export function BotSurface(props: {
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
}) {
  const shell = useShell();
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(
    props.initialMessages,
  );
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const title = name.trim();
    if (!title) return;
    setError(null);
    const response = await fetch("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
      note?: string;
      message?: string;
    };
    if (!response?.ok || !body.id || !body.note) {
      setError(body.message ?? "The bot could not be created.");
      return;
    }
    setSessionId(body.id);
    setMessages([
      { id: `note:${body.id}`, role: "assistant", content: body.note },
    ]);
    shell.upsertSession({
      id: body.id,
      title: body.title ?? title,
      updatedAt: new Date().toISOString(),
      surface: "bot",
    });
    window.history.replaceState(null, "", `/app/bots?session=${body.id}`);
    setName("");
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !sessionId) return;
    setError(null);
    const response = await fetch("/api/bots/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, content }),
    }).catch(() => null);
    if (!response?.ok) {
      setError("That message was not saved.");
      return;
    }
    const body = (await response.json()) as { id?: string };
    setMessages((current) => [
      ...current,
      { id: body.id ?? `local:${crypto.randomUUID()}`, role: "user", content },
    ]);
    setDraft("");
  };

  return (
    <div className="chat-page">
      <div className="chat-column">
        <TopBar title="Bot" />
        <div className="chat-scroll">
          <div className="chat-content">
            {sessionId && messages.length ? (
              <MessageList
                messages={messages}
                runObjective={null}
                streamingId={null}
                runSlot={null}
              />
            ) : (
              <div className="home home-calm">
                <p className="home-title">Bot</p>
                <p className="home-sub">
                  A saved thread only. No bot runtime is connected.
                </p>
              </div>
            )}
          </div>
        </div>
        {error ? (
          <p className="composer-error" role="alert">
            {error}
          </p>
        ) : null}
        {sessionId ? (
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="bot-draft">
              Message
            </label>
            <textarea
              id="bot-draft"
              className="composer-input"
              value={draft}
              rows={2}
              placeholder="Message"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="composer-bar">
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={!draft.trim()}
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="sr-only" htmlFor="bot-name">
              Bot name
            </label>
            <input
              id="bot-name"
              className="composer-input"
              value={name}
              placeholder="Name this bot"
              onChange={(event) => setName(event.target.value)}
            />
            <div className="composer-bar">
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={!name.trim()}
              >
                Create bot
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
