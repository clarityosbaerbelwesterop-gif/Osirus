"use client";

import {
  Code2,
  FlaskConical,
  Hammer,
  PenLine,
  Sigma,
  type LucideIcon,
} from "lucide-react";
import { STARTERS, type Starter } from "@/lib/ui/starters";
import { OsirusMark } from "../shell/osirus-mark";

const ICONS: Record<Starter["id"], LucideIcon> = {
  build: Hammer,
  research: FlaskConical,
  code: Code2,
  analyze: Sigma,
  create: PenLine,
};

/**
 * The entry surface for a new task. The starters are optional: each one only
 * begins a sentence in the composer, and anything typed freely works the same.
 */
export function ChatHome({
  firstName,
  onStart,
}: {
  firstName: string | null;
  onStart: (starter: Starter) => void;
}) {
  return (
    <div className="home">
      <div className="home-hero">
        <OsirusMark size={44} />
        <div>
          <h2 className="home-title">
            {firstName
              ? `What are we working on, ${firstName}?`
              : "What are we working on?"}
          </h2>
          <p className="home-sub">
            Describe the outcome. Osirus plans the steps, uses the right tools,
            checks the result and asks before acting outside its sandbox.
          </p>
        </div>
      </div>
      <ul className="starter-grid" aria-label="Ways to start">
        {STARTERS.map((starter) => {
          const Icon = ICONS[starter.id];
          return (
            <li key={starter.id}>
              <button
                type="button"
                className="starter"
                onClick={() => onStart(starter)}
              >
                <Icon size={20} aria-hidden="true" className="starter-icon" />
                <span className="starter-label">{starter.label}</span>
                <span className="starter-description">
                  {starter.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
