"use client";

import { Bot, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { agentsMentioned } from "@/lib/agents/mentions";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "../assistant/prompt-input";

/** A bot as the browser sees it: its class, never its model. */
export type AgentCard = {
  id: string;
  name: string;
  status: "active" | "paused";
  tier?: "top" | "balanced" | "fast";
  /** Legacy fixtures only; never rendered. */
  modelId?: string;
};

/**
 * Roles fix the model class: experts (engineering, data, research, law,
 * finance) get the top class, everyday roles the balanced one.
 */
const ROLES = [
  {
    id: "software",
    label: "Software Engineer",
    prompt:
      "Rolle: Software Engineer. Du schreibst, prüfst und erklärst Code auf Senior-Niveau: korrekt, sicher, getestet, mit klaren Begründungen.",
  },
  {
    id: "database",
    label: "Database Engineer",
    prompt:
      "Rolle: Database Engineer. Du entwirfst Schemas, Migrationen, Indizes und Abfragen für Postgres und andere Datenbanken, mit Blick auf Korrektheit, Sicherheit und Performance.",
  },
  {
    id: "research",
    label: "Research Analyst",
    prompt:
      "Rolle: Research Analyst. Du analysierst Fragen gründlich, trennst Fakten von Annahmen und lieferst belastbare, strukturierte Ergebnisse.",
  },
  {
    id: "strategy",
    label: "Strategie-Berater",
    prompt:
      "Rolle: Strategie-Berater (CEO-Niveau). Du triffst klare Empfehlungen mit Zahlen, Risiken und nächsten Schritten.",
  },
  {
    id: "legal",
    label: "Recht & Verträge",
    prompt:
      "Rolle: Jurist für Verträge und Compliance (DE/EU). Du prüfst präzise und weist auf Grenzen einer rechtlichen Einschätzung hin.",
  },
  {
    id: "writer",
    label: "Texter",
    prompt:
      "Rolle: Texter. Du schreibst klare, überzeugende Texte im gewünschten Ton.",
  },
  {
    id: "support",
    label: "Kundensupport",
    prompt:
      "Rolle: Kundensupport. Du antwortest freundlich, kurz und lösungsorientiert.",
  },
  { id: "custom", label: "Eigene Rolle", prompt: "" },
] as const;

const TIER_LABEL = {
  top: "Top-Modell",
  balanced: "Ausgewogen",
  fast: "Schnell",
} as const;

export function AgentsStudio(props: { initialAgents?: readonly AgentCard[] }) {
  const [agents, setAgents] = useState<AgentCard[]>([
    ...(props.initialAgents ?? []),
  ]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["id"]>("software");
  const [prompt, setPrompt] = useState("");
  const [room, setRoom] = useState("");
  const [roomTitle, setRoomTitle] = useState("Gruppe");
  const [selected, setSelected] = useState<string[]>(
    (props.initialAgents ?? []).map((agent) => agent.id),
  );
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const members = useMemo(
    () =>
      agents
        .filter((agent) => selected.includes(agent.id))
        .map((agent) => ({ id: agent.id, name: agent.name })),
    [agents, selected],
  );
  const mentioned = agentsMentioned(message, members);
  const rolePrompt = ROLES.find((item) => item.id === role)?.prompt ?? "";

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          systemPrompt: [rolePrompt, prompt.trim()]
            .filter(Boolean)
            .join("\n\n"),
          modelId: "auto",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        agent?: AgentCard;
        message?: string;
      };
      if (!response.ok || !body.agent) {
        setError(body.message ?? "Der Bot konnte nicht angelegt werden.");
        return;
      }
      setAgents((current) => [body.agent!, ...current]);
      setSelected((current) => [...current, body.agent!.id]);
      setName("");
      setPrompt("");
    } finally {
      setBusy(false);
    }
  };

  const openRoom = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/group-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: roomTitle, agentIds: selected }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        chat?: { id: string };
        message?: string;
      };
      if (!response.ok || !body.chat) {
        setError(body.message ?? "Der Gruppenchat wurde nicht angelegt.");
        return;
      }
      setRoom(body.chat.id);
      setNote("Gruppenchat bereit. Mit @Name sprichst du einen Bot an.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (busy) return;
    setError(null);
    if (!room) {
      setNote(
        mentioned.length
          ? `Angesprochen: ${mentioned.map((agent) => agent.name).join(", ")}. Lege zuerst einen Gruppenchat an.`
          : "Keine @Erwähnung. Es antwortet niemand.",
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/group-chats/${room}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        replies?: {
          name?: string;
          status: string;
          text?: string;
          message?: string;
        }[];
      };
      if (!response.ok) {
        setError(body.message ?? "Die Nachricht wurde nicht gesendet.");
        return;
      }
      if (!body.replies?.length) {
        setNote(body.message ?? "Keine Antwort.");
        return;
      }
      setNote(
        body.replies
          .map(
            (reply) =>
              `${reply.name ?? "Bot"}: ${reply.text ?? reply.message ?? reply.status}`,
          )
          .join("\n\n"),
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="recommend-grid">
      <section className="card" aria-label="Neuer Bot">
        <p className="subtle">
          Ein Bot hat eine Rolle. Osirus wählt dazu das passende Modell:
          Experten-Rollen bekommen ein Top-Modell.
        </p>
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
            onChange={(event) =>
              setRole(event.target.value as (typeof ROLES)[number]["id"])
            }
          >
            {ROLES.map((item) => (
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
        <button
          type="button"
          className="btn"
          disabled={
            busy || !name.trim() || (role === "custom" && !prompt.trim())
          }
          onClick={() => void create()}
        >
          Bot anlegen
        </button>
      </section>
      <section className="card" aria-label="Bots">
        {agents.length === 0 ? (
          <p>Noch kein Bot.</p>
        ) : (
          <ul className="bot-list">
            {agents.map((agent) => (
              <li key={agent.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(agent.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, agent.id]
                          : current.filter((id) => id !== agent.id),
                      )
                    }
                  />
                  <Bot size={14} aria-hidden="true" />
                  <span>{agent.name}</span>
                  {agent.tier ? (
                    <span className="badge">
                      <Sparkles size={11} aria-hidden="true" />{" "}
                      {TIER_LABEL[agent.tier]}
                    </span>
                  ) : null}
                  {agent.status === "paused" ? (
                    <span className="badge">pausiert</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card" aria-label="Gruppenchat">
        <label>
          Titel
          <input
            aria-label="Titel des Gruppenchats"
            value={roomTitle}
            onChange={(event) => setRoomTitle(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || selected.length === 0}
          onClick={() => void openRoom()}
        >
          Gruppenchat anlegen
        </button>
        <PromptInput label="Gruppenchat" onSubmit={() => void send()}>
          <PromptInputTextarea
            aria-label="Nachricht"
            value={message}
            placeholder="@Name …"
            onChange={(event) => setMessage(event.target.value)}
          />
          <p className="subtle" aria-live="polite">
            {mentioned.length
              ? `Antwortet: ${mentioned.map((agent) => agent.name).join(", ")}`
              : "Ohne @Erwähnung antwortet niemand."}
          </p>
          <PromptInputActions>
            <button
              type="submit"
              className="btn"
              disabled={busy || !message.trim()}
            >
              Senden
            </button>
          </PromptInputActions>
        </PromptInput>
        {note ? <p className="stream-line">{note}</p> : null}
      </section>
      {error ? (
        <p role="alert" className="subtle">
          {error}
        </p>
      ) : null}
    </div>
  );
}
