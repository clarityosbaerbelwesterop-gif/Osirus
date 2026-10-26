"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Code2,
  Gauge,
  MessageSquare,
  Plug,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";

/** Dispatch on window to open the tour again (settings, help). */
export const TOUR_EVENT = "osirus:tour";

export function openTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

type Step = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  points?: string[];
  /** A real first task or the place to go, opened in the app. */
  action?: { label: string; href: string };
};

const ASK =
  "Erkläre mir den Zinseszins an einem Beispiel: 10.000 € über 10 Jahre mit 5 % Zinsen.";
const TASK =
  "Recherchiere die drei wichtigsten Trends bei KI-Agenten in diesem Jahr und fasse sie mit Quellen auf einer Seite zusammen.";

const chatHref = (prompt: string) =>
  `/app?prompt=${encodeURIComponent(prompt)}`;
const agentHref = (prompt: string) =>
  `/app/agent?new=1&prompt=${encodeURIComponent(prompt)}`;

function steps(name: string | null): Step[] {
  return [
    {
      id: "welcome",
      icon: Sparkles,
      title: name ? `Willkommen bei Osirus, ${name}` : "Willkommen bei Osirus",
      body: "Dein KI-Team mit Freigabeknopf: Osirus beantwortet Fragen, erledigt Aufgaben selbstständig und arbeitet in deinen Repositories. Riskante Schritte führt es erst aus, wenn du sie freigibst.",
      points: [
        "In einer Minute siehst du, was wo ist.",
        "Am Ende wartet eine erste Aufgabe auf dich.",
      ],
    },
    {
      id: "agents",
      icon: MessageSquare,
      title: "Agents: einfach fragen",
      body: "Schreib wie in einem Chat. Für jede Nachricht wählt Osirus automatisch das passende Modell: ein schnelles für Kurzes, ein Top-Modell für Schweres. Einstellen musst du nichts.",
      points: [
        "Deine Chats werden gespeichert und stehen links in der Seitenleiste.",
        "Über die Bot-Auswahl antwortet einer deiner Spezialisten.",
      ],
      action: { label: "Beispielfrage stellen", href: chatHref(ASK) },
    },
    {
      id: "bots",
      icon: Bot,
      title: "Bots: deine Spezialisten",
      body: "Lege Bots mit einer festen Rolle an, etwa Software-Engineer, Jurist oder Übersetzer. Jeder Bot arbeitet mit einem festen Modell, das zu seiner Rolle passt; Experten bekommen automatisch ein Top-Modell.",
      action: { label: "Bots ansehen", href: "/app/agents" },
    },
    {
      id: "rouge",
      icon: Zap,
      title: "Rouge Agent: erledigt Aufgaben",
      body: "Gib ein Ziel statt einer Frage. Der Agent plant, recherchiert, nutzt Werkzeuge und arbeitet Schritt für Schritt. Vor riskanten Aktionen fragt er dich; du entscheidest unter Approvals.",
      action: { label: "Beispielaufgabe starten", href: agentHref(TASK) },
    },
    {
      id: "code",
      icon: Code2,
      title: "Code: dein Entwickler",
      body: "Verbinde GitHub, wähle ein Repository und beschreibe die Aufgabe. Code liest den Code, ändert ihn, führt Tests aus und öffnet einen Pull Request. Nur hier wählst du das Modell selbst.",
      action: { label: "Code öffnen", href: "/app/coding" },
    },
    {
      id: "connections",
      icon: Plug,
      title: "Verbindungen: deine Werkzeuge",
      body: "GitHub, Neon, Vercel, Cloudflare oder eigene MCP-Server: einmal verbinden, dann nutzen Rouge Agent und Code sie für dich, mit deiner Freigabe.",
      action: { label: "Verbindungen öffnen", href: "/app/connections" },
    },
    {
      id: "plan",
      icon: Gauge,
      title: "Kontingent, Pläne und Sicherheit",
      body: "Die Balken unten in der Seitenleiste zeigen, wie viel deines 5-Stunden- und deines Wochenkontingents verbraucht ist. Mehr Kapazität gibt es mit Pro.",
      points: [
        "Deine Daten liegen in der EU (Frankfurt).",
        "Zugangsdaten zu deinen Diensten werden verschlüsselt gespeichert.",
      ],
      action: { label: "Pläne ansehen", href: "/app/settings/usage" },
    },
    {
      id: "start",
      icon: Sparkles,
      title: "Leg los",
      body: "Such dir einen ersten Schritt aus. Diese Einführung findest du jederzeit wieder unter Settings.",
    },
  ];
}

const STARTS = [
  {
    icon: MessageSquare,
    label: "Eine Frage stellen",
    detail: "Zinseszins an einem Beispiel",
    href: chatHref(ASK),
  },
  {
    icon: Zap,
    label: "Eine Aufgabe übergeben",
    detail: "Recherche mit Quellen",
    href: agentHref(TASK),
  },
  {
    icon: Plug,
    label: "GitHub verbinden",
    detail: "Für Code und den Agenten",
    href: "/app/connections",
  },
];

/**
 * The introduction for a new account: what each part of Osirus does, with a
 * real first task at the end. Opens by itself until it was finished or
 * skipped once (`onDone` records that); `openTour()` replays it.
 */
export function OnboardingTour({
  initialOpen,
  name,
  onDone,
}: {
  initialOpen: boolean;
  name: string | null;
  onDone?: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [index, setIndex] = useState(0);
  const recorded = useRef(false);
  const primary = useRef<HTMLButtonElement>(null);
  const list = steps(name);
  const step = list[index];
  const last = index === list.length - 1;
  const Icon = step.icon;

  useEffect(() => {
    const replay = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (recorded.current) return;
    recorded.current = true;
    void Promise.resolve(onDone?.()).catch(() => {
      // Not recorded: the tour simply opens once more next time.
      recorded.current = false;
    });
  }, [onDone]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay" />
        <Dialog.Popup
          className="dialog tour"
          data-step={step.id}
          initialFocus={primary}
        >
          <div className="tour-head">
            <span className="tour-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <p className="tour-count">
              Schritt {index + 1} von {list.length}
            </p>
          </div>
          <div aria-live="polite">
            <Dialog.Title className="dialog-title tour-title">
              {step.title}
            </Dialog.Title>
            <Dialog.Description className="dialog-description tour-body">
              {step.body}
            </Dialog.Description>
            {step.points ? (
              <ul className="tour-points">
                {step.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            {last ? (
              <ul className="tour-starts">
                {STARTS.map((start) => {
                  const StartIcon = start.icon;
                  return (
                    <li key={start.label}>
                      <Link
                        className="tour-start"
                        href={start.href as Route}
                        onClick={close}
                      >
                        <StartIcon size={16} aria-hidden="true" />
                        <span>
                          <strong>{start.label}</strong>
                          <span className="tour-start-detail">
                            {start.detail}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {step.action ? (
              <Link
                className="tour-action"
                href={step.action.href as Route}
                onClick={close}
              >
                {step.action.label}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <div className="tour-dots" aria-hidden="true">
            {list.map((item, at) => (
              <span
                key={item.id}
                className="tour-dot"
                data-active={at === index ? "" : undefined}
              />
            ))}
          </div>
          <div className="dialog-actions tour-actions">
            {index === 0 ? (
              <button type="button" className="btn btn-ghost" onClick={close}>
                Überspringen
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIndex(index - 1)}
              >
                <ArrowLeft size={14} aria-hidden="true" />
                Zurück
              </button>
            )}
            {last ? (
              <button
                ref={primary}
                type="button"
                className="btn btn-primary"
                onClick={close}
              >
                Fertig
              </button>
            ) : (
              <button
                ref={primary}
                type="button"
                className="btn btn-primary"
                onClick={() => setIndex(index + 1)}
              >
                {index === 0 ? "Los geht's" : "Weiter"}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
