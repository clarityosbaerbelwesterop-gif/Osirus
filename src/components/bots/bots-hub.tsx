"use client";

import { MessageSquare, Plus, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { BOT_ROLES, BOT_TIER_LABEL, type BotRoleId } from "@/lib/agents/roles";
import { cx } from "../ui/cx";
import { BotOrb } from "./bot-orb";

/** A bot as the browser sees it: its role and class, never its model. */
export type HubBot = {
  id: string;
  name: string;
  status: "active" | "paused";
  role: string | null;
  tier?: "top" | "balanced" | "fast";
};

export type HubGroup = {
  id: string;
  title: string;
  updatedAt: string;
  members: { id: string; name: string }[];
  messageCount: number;
  last: {
    role: "user" | "agent";
    agentId: string | null;
    content: string;
  } | null;
};

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
  };
  return body.message ?? fallback;
}

function CreateBot({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState<BotRoleId>("software");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rolePrompt = BOT_ROLES.find((item) => item.id === role)?.prompt ?? "";

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          systemPrompt: [rolePrompt, prompt.trim()]
            .filter(Boolean)
            .join("\n\n"),
          modelId: "auto",
        }),
      });
      if (!response.ok) {
        setError(
          await readError(response, "Der Bot konnte nicht angelegt werden."),
        );
        return;
      }
      const body = (await response.json()) as { agent?: { id: string } };
      if (body.agent) router.push(`/app/agents/${body.agent.id}` as Route);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card hub-form"
      aria-label="Neuer Bot"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="hub-form-preview" aria-hidden="true">
        <BotOrb seed={name.trim() || "neu"} size={52} state="idle" />
      </div>
      <label>
        Name
        <input
          aria-label="Name des Bots"
          value={name}
          maxLength={80}
          placeholder="z. B. Ada"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Rolle
        <select
          aria-label="Rolle des Bots"
          value={role}
          onChange={(event) => setRole(event.target.value as BotRoleId)}
        >
          {BOT_ROLES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {role === "custom" ? "Anweisungen" : "Zusätzliche Anweisungen"}
        <textarea
          aria-label="Anweisungen"
          value={prompt}
          placeholder={
            role === "custom"
              ? "Was macht der Bot, wie antwortet er?"
              : "Optional: Ton, Schwerpunkte, Regeln"
          }
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <p className="subtle">
        Osirus wählt das Modell passend zur Rolle: Experten-Rollen bekommen ein
        Top-Modell.
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="hub-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            busy || !name.trim() || (role === "custom" && !prompt.trim())
          }
        >
          {busy ? "Wird angelegt…" : "Bot anlegen und chatten"}
        </button>
      </div>
    </form>
  );
}

function CreateGroup({
  bots,
  onCancel,
}: {
  bots: HubBot[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const active = bots.filter((bot) => bot.status === "active");
  const [title, setTitle] = useState("Team");
  const [picked, setPicked] = useState<string[]>(active.map((bot) => bot.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/group-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), agentIds: picked }),
      });
      if (!response.ok) {
        setError(
          await readError(response, "Der Gruppenchat wurde nicht angelegt."),
        );
        return;
      }
      const body = (await response.json()) as { chat?: { id: string } };
      if (body.chat) router.push(`/app/agents/groups/${body.chat.id}` as Route);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card hub-form"
      aria-label="Neuer Gruppenchat"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label>
        Titel
        <input
          aria-label="Titel des Gruppenchats"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <fieldset className="hub-pick">
        <legend>Wer ist dabei?</legend>
        {active.map((bot) => {
          const on = picked.includes(bot.id);
          return (
            <button
              key={bot.id}
              type="button"
              className={cx("hub-pick-bot", on && "hub-pick-bot-on")}
              aria-pressed={on}
              onClick={() =>
                setPicked((current) =>
                  on
                    ? current.filter((id) => id !== bot.id)
                    : [...current, bot.id],
                )
              }
            >
              <BotOrb seed={bot.id} size={20} />
              {bot.name}
            </button>
          );
        })}
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="hub-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !title.trim() || picked.length === 0}
        >
          {busy ? "Wird angelegt…" : "Gruppenchat öffnen"}
        </button>
      </div>
    </form>
  );
}

const timeFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const subscribeNever = () => () => undefined;
const onClient = () => true;
const onServer = () => false;

/** A time in the reader's zone, known only after hydration. */
function LocalTime({ iso }: { iso: string }) {
  const client = useSyncExternalStore(subscribeNever, onClient, onServer);
  return (
    <time dateTime={iso}>{client ? timeFormat.format(new Date(iso)) : ""}</time>
  );
}

/**
 * Bots: the team. Every bot has its own room (its orb, its conversations);
 * group chats bring several bots into one thread that stays.
 */
export function BotsHub(props: { bots: HubBot[]; groups: HubGroup[] }) {
  const [bots, setBots] = useState(props.bots);
  const [creating, setCreating] = useState(props.bots.length === 0);
  const [grouping, setGrouping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));

  const toggle = async (bot: HubBot) => {
    const status = bot.status === "active" ? "paused" : "active";
    setError(null);
    const response = await fetch(`/api/agents/${bot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!response?.ok) {
      setError("Der Bot konnte nicht geändert werden.");
      return;
    }
    setBots((current) =>
      current.map((item) => (item.id === bot.id ? { ...item, status } : item)),
    );
  };

  const remove = async (bot: HubBot) => {
    if (
      !window.confirm(
        `${bot.name} entfernen? Seine Unterhaltungen bleiben im Verlauf.`,
      )
    )
      return;
    setError(null);
    const response = await fetch(`/api/agents/${bot.id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) {
      setError("Der Bot konnte nicht entfernt werden.");
      return;
    }
    setBots((current) => current.filter((item) => item.id !== bot.id));
  };

  return (
    <div className="hub">
      <section className="hub-section" aria-labelledby="team-heading">
        <div className="hub-head">
          <h2 id="team-heading">Dein Team</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCreating((value) => !value)}
            aria-expanded={creating}
          >
            <Plus size={16} aria-hidden="true" /> Neuer Bot
          </button>
        </div>
        {creating ? <CreateBot onCancel={() => setCreating(false)} /> : null}
        {bots.length ? (
          <ul className="hub-grid">
            {bots.map((bot) => (
              <li
                key={bot.id}
                className={cx(
                  "bot-card",
                  bot.status === "paused" && "bot-card-paused",
                )}
              >
                <Link
                  href={`/app/agents/${bot.id}` as Route}
                  className="bot-card-main"
                  aria-label={`Mit ${bot.name} chatten`}
                >
                  <BotOrb seed={bot.id} size={56} />
                  <span className="bot-card-name">{bot.name}</span>
                  <span className="bot-card-role">
                    {bot.role ?? "Eigene Rolle"}
                  </span>
                </Link>
                <div className="bot-card-meta">
                  {bot.tier ? (
                    <span className="badge">{BOT_TIER_LABEL[bot.tier]}</span>
                  ) : null}
                  {bot.status === "paused" ? (
                    <span className="badge">pausiert</span>
                  ) : null}
                </div>
                <div className="bot-card-actions">
                  <Link
                    href={`/app/agents/${bot.id}` as Route}
                    className="btn btn-sm"
                  >
                    <MessageSquare size={14} aria-hidden="true" /> Chatten
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void toggle(bot)}
                  >
                    {bot.status === "active" ? "Pausieren" : "Aktivieren"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void remove(bot)}
                    aria-label={`${bot.name} entfernen`}
                  >
                    Entfernen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : creating ? null : (
          <p className="subtle">Noch kein Bot. Leg deinen ersten an.</p>
        )}
      </section>

      <section className="hub-section" aria-labelledby="groups-heading">
        <div className="hub-head">
          <h2 id="groups-heading">Gruppenchats</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setGrouping((value) => !value)}
            aria-expanded={grouping}
            disabled={!bots.some((bot) => bot.status === "active")}
          >
            <Users size={16} aria-hidden="true" /> Neuer Gruppenchat
          </button>
        </div>
        {grouping ? (
          <CreateGroup bots={bots} onCancel={() => setGrouping(false)} />
        ) : null}
        {props.groups.length ? (
          <ul className="hub-groups">
            {props.groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/app/agents/groups/${group.id}` as Route}
                  className="group-card"
                >
                  <span className="group-card-orbs" aria-hidden="true">
                    {group.members.slice(0, 4).map((member) => (
                      <BotOrb key={member.id} seed={member.id} size={26} />
                    ))}
                  </span>
                  <span className="group-card-text">
                    <span className="group-card-title">{group.title}</span>
                    <span className="group-card-last">
                      {group.last
                        ? `${
                            group.last.role === "user"
                              ? "Du"
                              : (names.get(group.last.agentId ?? "") ?? "Bot")
                          }: ${group.last.content}`
                        : group.members.map((member) => member.name).join(", ")}
                    </span>
                  </span>
                  <span className="group-card-time">
                    <LocalTime iso={group.updatedAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">
            Noch kein Gruppenchat. Hol mehrere Bots in einen Chat und sprich sie
            mit @Name an.
          </p>
        )}
      </section>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
