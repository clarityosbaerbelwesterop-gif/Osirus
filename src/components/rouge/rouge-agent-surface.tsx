"use client";

import {
  Globe,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Zap,
} from "lucide-react";
import { useState, type ComponentProps } from "react";
import { ChatHub } from "../chat/chat-hub";

const CAPABILITIES = [
  {
    icon: Globe,
    title: "Recherche",
    text: "Sucht und liest Quellen im Web und belegt, was er sagt.",
  },
  {
    icon: Terminal,
    title: "Code & Rechnen",
    text: "Schreibt und startet Code in einer abgeschotteten Sandbox.",
  },
  {
    icon: ShieldCheck,
    title: "Prüfung",
    text: "Ein zweiter Durchgang prüft das Ergebnis, bevor es fertig ist.",
  },
  {
    icon: Users,
    title: "Team & Repos",
    text: "Fragt deine Bots, liest deine GitHub-Repos, schreibt mit Freigabe und übergibt Aufgaben an Code.",
  },
];

const TASKS = [
  "Recherchiere die fünf wichtigsten Anbieter für Vektordatenbanken und vergleiche Preis, Latenz und Grenzen.",
  "Rechne durch, ab welcher Nutzerzahl sich ein eigener GPU-Server gegenüber der Cloud lohnt.",
  "Plane eine Datenbank-Migration mit Rückweg für jeden Schritt.",
  "Baue eine Landingpage mit Anmeldeformular und Bestätigung.",
  "Finde meine leeren GitHub-Repos und frag meine Bots, wofür wir eines davon nutzen.",
];

function RougeHero(props: { onPick: (task: string) => void }) {
  return (
    <div className="ra-hero">
      <div className="ra-hero-icon" aria-hidden="true">
        <Zap size={26} />
      </div>
      <h2 className="ra-hero-title">Rouge Agent</h2>
      <p className="ra-hero-sub">
        Gib ihm ein Ziel. Er plant, arbeitet die Schritte selbst ab und fragt
        dich vor jeder Aktion nach außen.
      </p>
      <div className="ra-caps">
        {CAPABILITIES.map((capability, index) => (
          <div
            key={capability.title}
            className="ra-cap"
            style={{ ["--d" as string]: `${index * 60}ms` }}
          >
            <capability.icon size={18} aria-hidden="true" />
            <p className="ra-cap-title">{capability.title}</p>
            <p className="ra-cap-text">{capability.text}</p>
          </div>
        ))}
      </div>
      <div className="ra-tasks">
        {TASKS.map((task, index) => (
          <button
            key={task}
            type="button"
            className="ac-chip ra-task"
            style={{ ["--d" as string]: `${200 + index * 50}ms` }}
            onClick={() => props.onPick(task)}
          >
            {task}
          </button>
        ))}
      </div>
    </div>
  );
}

type HubProps = Omit<
  ComponentProps<typeof ChatHub>,
  | "kind"
  | "agentModelRef"
  | "accessory"
  | "emptySlot"
  | "prefill"
  | "titleFallback"
>;

/**
 * The Rouge Agent: the agent runtime. Osirus picks one model per task, by how
 * hard and how large it is, and keeps it for the whole run.
 */
export function RougeAgentSurface(
  props: HubProps & { initialPrompt?: string | null },
) {
  const { initialPrompt, ...hub } = props;
  const [prefill, setPrefill] = useState(
    initialPrompt ? { text: initialPrompt, nonce: 1 } : null,
  );
  return (
    <ChatHub
      {...hub}
      kind="agent"
      titleFallback="Rouge Agent"
      agentModelRef={null}
      prefill={prefill}
      emptySlot={
        <RougeHero
          onPick={(task) => setPrefill({ text: task, nonce: Date.now() })}
        />
      }
      accessory={
        <div className="ra-bar">
          <span
            className="ac-auto"
            title="Osirus wählt das Modell nach Schwierigkeit und Umfang der Aufgabe"
          >
            <Sparkles size={13} aria-hidden="true" /> Auto · ein Modell je
            Auftrag
          </span>
        </div>
      }
    />
  );
}
