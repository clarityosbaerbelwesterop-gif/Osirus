"use client";

import { ArrowUp, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentsMentioned, everyoneMentioned } from "@/lib/agents/mentions";
import { Markdown } from "../chat/markdown";
import { notifyUsage } from "../motion/quota-bars";
import { TopBar } from "../shell/top-bar";
import { cx } from "../ui/cx";
import { BotOrb } from "./bot-orb";

export type GroupRoomMessage = {
  id: string;
  role: "user" | "agent";
  agentId: string | null;
  content: string;
  status: "stored" | "completed" | "unavailable" | "failed";
  createdAt: string;
};

export type GroupRoomProps = {
  group: {
    id: string;
    title: string;
    members: { id: string; name: string }[];
  };
  initialMessages: GroupRoomMessage[];
};

type Reply = {
  agentId: string;
  name?: string;
  status: "completed" | "unavailable";
  text?: string;
  message?: string;
};

/**
 * A group chat with the workspace's bots. Everything said stays: the thread
 * loads from the server, and every bot reads the earlier turns. Only the
 * bots named with @Name answer; @alle asks every bot of the group.
 */
export function GroupRoom(props: GroupRoomProps) {
  const { group } = props;
  const [messages, setMessages] = useState(props.initialMessages);
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const names = useMemo(
    () => new Map(group.members.map((member) => [member.id, member.name])),
    [group.members],
  );
  const addressed = everyoneMentioned(input)
    ? group.members
    : agentsMentioned(input, group.members);
  const busy = waiting.length > 0;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, waiting]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [input]);

  const mention = (name: string) => {
    setInput((current) => {
      const tag = `@${name} `;
      return current.includes(`@${name}`) ? current : `${tag}${current}`;
    });
    textareaRef.current?.focus();
  };

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;
    setError(null);
    const asked = (
      everyoneMentioned(content)
        ? group.members
        : agentsMentioned(content, group.members)
    ).map((member) => member.id);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        agentId: null,
        content,
        status: "stored",
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setWaiting(asked.length ? asked : []);
    try {
      const response = await fetch(`/api/group-chats/${group.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        replies?: Reply[];
      };
      if (!response.ok) {
        setError(body.message ?? "Die Nachricht wurde nicht gesendet.");
        return;
      }
      const replies = body.replies ?? [];
      if (replies.length) {
        setMessages((current) => [
          ...current,
          ...replies.map((reply, index) => ({
            id: `reply-${Date.now()}-${index}`,
            role: "agent" as const,
            agentId: reply.agentId,
            content: reply.text ?? reply.message ?? "",
            status:
              reply.status === "completed"
                ? ("completed" as const)
                : ("unavailable" as const),
            createdAt: new Date().toISOString(),
          })),
        ]);
      }
    } catch {
      setError("Die Verbindung wurde unterbrochen. Bitte noch einmal senden.");
    } finally {
      setWaiting([]);
      notifyUsage();
    }
  };

  return (
    <div className="ac group-room">
      <TopBar
        title={group.title}
        titleAs="p"
        actions={
          <Link href={"/app/agents" as Route} className="btn btn-ghost btn-sm">
            <Users size={15} aria-hidden="true" /> Team
          </Link>
        }
      />
      <div className="group-members" aria-label="Mitglieder">
        {group.members.map((member) => (
          <button
            key={member.id}
            type="button"
            className="group-member"
            onClick={() => mention(member.name)}
            title={`@${member.name} ansprechen`}
          >
            <BotOrb
              seed={member.id}
              size={22}
              state={waiting.includes(member.id) ? "thinking" : "idle"}
            />
            <span>{member.name}</span>
          </button>
        ))}
        {group.members.length > 1 ? (
          <button
            type="button"
            className="group-member group-member-all"
            onClick={() => mention("alle")}
            title="Alle Bots der Gruppe fragen"
          >
            @alle
          </button>
        ) : null}
      </div>
      <div className="ac-scroll" ref={scrollRef}>
        <div className="ac-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="group-empty">
              <div className="group-empty-orbs" aria-hidden="true">
                {group.members.slice(0, 5).map((member) => (
                  <BotOrb key={member.id} seed={member.id} size={44} />
                ))}
              </div>
              <h1 className="ac-hero-title">{group.title}</h1>
              <p className="ac-hero-sub">
                Sprich einen Bot mit @Name an oder alle mit @alle. Jeder Bot
                kennt den bisherigen Verlauf.
              </p>
            </div>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="ac-row ac-row-user">
                <div className="ac-user">{message.content}</div>
              </div>
            ) : (
              <div
                key={message.id}
                className={cx(
                  "ac-row ac-row-assistant",
                  message.status !== "completed" && "group-reply-muted",
                )}
              >
                <div className="ac-avatar" aria-hidden="true">
                  <BotOrb seed={message.agentId ?? message.id} size={24} />
                </div>
                <div className="ac-assistant">
                  <p className="ac-bot-name">
                    {names.get(message.agentId ?? "") ?? "Bot"}
                  </p>
                  {message.status === "completed" ? (
                    <Markdown content={message.content} />
                  ) : (
                    <p className="subtle">{message.content}</p>
                  )}
                </div>
              </div>
            ),
          )}
          {waiting.map((agentId) => (
            <div key={`wait-${agentId}`} className="ac-row ac-row-assistant">
              <div className="ac-avatar" aria-hidden="true">
                <BotOrb seed={agentId} size={24} state="thinking" />
              </div>
              <div className="ac-assistant">
                <p className="ac-bot-name">{names.get(agentId) ?? "Bot"}</p>
                <p className="subtle" role="status">
                  denkt nach …
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ac-dock">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <form
          className={cx("ac-composer", busy && "ac-composer-busy")}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={textareaRef}
            className="ac-input"
            value={input}
            rows={1}
            placeholder="@Name oder @alle …"
            aria-label="Nachricht"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="ac-composer-bar">
            <span className="group-addressed" aria-live="polite">
              {addressed.length
                ? `Antwortet: ${addressed.map((member) => member.name).join(", ")}`
                : "Ohne @Erwähnung antwortet niemand."}
            </span>
            <span className="ac-composer-spacer" />
            <button
              type="submit"
              className="ac-send"
              disabled={!input.trim() || busy}
              aria-label="Senden"
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
