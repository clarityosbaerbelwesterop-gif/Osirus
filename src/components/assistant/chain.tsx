"use client";

import type { ReactNode } from "react";

/**
 * Step timeline for sub-agents.
 * Status names follow Nexus UI ChainOfThought (MIT):
 * pending, active, completed, error.
 * https://github.com/victorcodess/nexus-ui
 * Original markup. No copied source, no logos.
 */

export type StepStatus =
  "pending" | "active" | "completed" | "error" | "unavailable";

export function ChainOfThought(props: { label: string; children: ReactNode }) {
  return (
    <ol className="chain" aria-label={props.label}>
      {props.children}
    </ol>
  );
}

export function ChainStep(props: {
  status: StepStatus;
  title: string;
  detail?: string | null;
}) {
  return (
    <li className="chain-step" data-status={props.status}>
      <span className="chain-mark" aria-hidden="true" />
      <div>
        <p className="chain-title">
          {props.status === "active" ? (
            <span className="text-shimmer">{props.title}</span>
          ) : (
            props.title
          )}
        </p>
        {props.detail ? <p className="chain-detail">{props.detail}</p> : null}
      </div>
    </li>
  );
}
