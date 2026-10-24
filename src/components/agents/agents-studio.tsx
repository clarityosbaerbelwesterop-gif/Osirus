"use client";

import { useMemo, useState } from "react";
import { agentsMentioned } from "@/lib/agents/mentions";
import { ModelSelect, type ModelOption } from "../assistant/model-select";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "../assistant/prompt-input";

export type AgentCard = {
  id: string;
  name: string;
  modelId: string;
  status: "active" | "paused";
};

export function AgentsStudio(props: {
  initialAgents?: readonly AgentCard[];
  models?: readonly ModelOption[];
}) {
  const [agents, setAgents] = useState<AgentCard[]>([
    ...(props.initialAgents ?? []),
  ]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(props.models?.[0]?.id ?? "");
  const [room, setRoom] = useState("");
  const [roomTitle, setRoomTitle] = useState("Gruppe");
  const [selected, setSelected] = useState<string[]>(
    (props.initialAgents ?? []).map((agent) => agent.id),
  );
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const models = props.models ?? [];
  const members = useMemo(
    () =>
      agents
        .filter((agent) => selected.includes(agent.id))
        .map((agent) => ({ id: agent.id, name: agent.name })),
    [agents, selected],
  );
  const mentioned = agentsMentioned(message, members);

  const create = async () => {
    setError(null);
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        systemPrompt: prompt,
        modelId,
      }),
    });
    const body = (await response.json()) as {
      agent?: AgentCard;
      message?: string;
    };
    if (!response.ok || !body.agent) {
      setError(
        body.message ?? "Bald verfügbar. Der Agent wurde nicht angelegt.",
      );
      return;
    }
    setAgents((current) => [body.agent!, ...current]);
    setSelected((current) => [...current, body.agent!.id]);
    setName("");
    setPrompt("");
  };

  const openRoom = async () => {
    setError(null);
    const response = await fetch("/api/group-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: roomTitle, agentIds: selected }),
    });
    const body = (await response.json()) as {
      chat?: { id: string };
      message?: string;
    };
    if (!response.ok || !body.chat) {
      setError(body.message ?? "Der Gruppenchat wurde nicht angelegt.");
      return;
    }
    setRoom(body.chat.id);
    setNote(
      `Gruppenchat bereit. Nachrichten mit @Name gehen an genau diesen Agent.`,
    );
  };

  const send = async () => {
    setError(null);
    if (!room) {
      setNote(
        mentioned.length
          ? `Angesprochen: ${mentioned.map((agent) => agent.name).join(", ")}. Ein Gruppenchat ist noch nicht angelegt.`
          : "Keine @Erwähnung. Es antwortet niemand.",
      );
      return;
    }
    const response = await fetch(`/api/group-chats/${room}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    const body = (await response.json()) as {
      message?: string;
      replies?: { name?: string; status: string; text?: string }[];
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
        .map((reply) =>
          reply.text
            ? `${reply.name}: ${reply.text}`
            : `${reply.name ?? "Agent"}: ${reply.status}`,
        )
        .join("\n"),
    );
  };

  return (
    <div className="recommend-grid">
      <section className="card" aria-label="Neuer Agent">
        <p className="subtle">
          Ein Agent lebt in diesem Workspace. Eine öffentliche Adresse, ein
          Widget oder eine API gibt es nicht.
        </p>
        <label>
          Name
          <input
            aria-label="Name des Agents"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Systemanweisung
          <textarea
            aria-label="Systemanweisung"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <ModelSelect
          label="Modell"
          value={modelId}
          options={models}
          onChange={setModelId}
        />
        <button
          type="button"
          className="btn"
          disabled={!name.trim() || !modelId}
          onClick={() => void create()}
        >
          Agent anlegen
        </button>
      </section>
      <section className="card" aria-label="Agents">
        {agents.length === 0 ? (
          <p>Noch kein Agent.</p>
        ) : (
          <ul>
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
                  {agent.name} · {agent.modelId} · {agent.status}
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
          disabled={selected.length === 0}
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
            <button type="submit" className="btn" disabled={!message.trim()}>
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
