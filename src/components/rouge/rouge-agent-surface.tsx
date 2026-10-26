"use client";

import { Globe, ShieldCheck, Terminal, Users, Zap } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { ChatHub } from "../chat/chat-hub";
import { ModelPicker } from "../agents-chat/model-picker";
import { useGatewayModels } from "../agents-chat/use-models";

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
    title: "Zusammenarbeit",
    text: "Übernimmt Aufträge aus Agents und gibt Code an Code weiter.",
  },
];

const TASKS = [
  "Recherchiere die fünf wichtigsten Anbieter für Vektordatenbanken und vergleiche Preis, Latenz und Grenzen.",
  "Rechne durch, ab welcher Nutzerzahl sich ein eigener GPU-Server gegenüber der Cloud lohnt.",
  "Plane eine Datenbank-Migration mit Rückweg für jeden Schritt.",
  "Baue eine Landingpage mit Anmeldeformular und Bestätigung.",
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

/** The Rouge Agent: the agent runtime on the model chosen here. */
export function RougeAgentSurface(
  props: HubProps & { initialPrompt?: string | null },
) {
  const { initialPrompt, ...hub } = props;
  const { models, freeOnly, error, selected, choose } =
    useGatewayModels("osirus.rouge.model");
  const [prefill, setPrefill] = useState(
    initialPrompt ? { text: initialPrompt, nonce: 1 } : null,
  );
  return (
    <ChatHub
      {...hub}
      kind="agent"
      titleFallback="Rouge Agent"
      agentModelRef={selected}
      prefill={prefill}
      emptySlot={
        <RougeHero
          onPick={(task) => setPrefill({ text: task, nonce: Date.now() })}
        />
      }
      accessory={
        <div className="ra-bar">
          <span className="ra-bar-label">
            <Zap size={14} aria-hidden="true" /> Arbeitet mit
          </span>
          <ModelPicker
            models={models}
            value={selected}
            onChange={choose}
            freeOnly={freeOnly}
            error={error}
          />
        </div>
      }
    />
  );
}
