import type { ReactNode } from "react";
import { type Tone } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { RelativeTime } from "../ui/relative-time";

export type HealthFacts = {
  healthLabel: string;
  healthTone: Tone;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastToolCallAt: string | null;
};

/**
 * One connection: what it is, its state, who it acts as, what it can do,
 * and its recorded health. Actions are whatever the caller passes; a card
 * without actions shows none.
 */
export function ConnectionCard({
  icon,
  name,
  stateLabel,
  stateTone,
  identity,
  description,
  capabilities,
  health,
  actions,
  children,
}: {
  icon: ReactNode;
  name: string;
  stateLabel: string;
  stateTone: Tone;
  identity?: ReactNode;
  description?: ReactNode;
  capabilities?: string[];
  health?: HealthFacts | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="conn card" aria-label={`${name}: ${stateLabel}`}>
      <header className="conn-head">
        <span className="conn-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="conn-title">
          <h3>{name}</h3>
          {identity ? <p className="subtle">{identity}</p> : null}
        </div>
        <Badge tone={stateTone}>{stateLabel}</Badge>
      </header>
      {description ? <div className="conn-desc">{description}</div> : null}
      {capabilities?.length ? (
        <ul className="conn-caps" aria-label="Capabilities">
          {capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      ) : null}
      {health ? (
        <dl className="conn-health">
          <div>
            <dt>Health</dt>
            <dd>
              <Badge tone={health.healthTone}>{health.healthLabel}</Badge>
            </dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd className="tabular">
              {health.lastCheckedAt ? (
                <RelativeTime value={health.lastCheckedAt} />
              ) : (
                "Never"
              )}
              {health.latencyMs !== null ? ` · ${health.latencyMs} ms` : ""}
            </dd>
          </div>
          <div>
            <dt>Last success</dt>
            <dd className="tabular">
              {health.lastOkAt ? (
                <RelativeTime value={health.lastOkAt} />
              ) : (
                "None yet"
              )}
            </dd>
          </div>
          <div>
            <dt>Last tool call</dt>
            <dd className="tabular">
              {health.lastToolCallAt ? (
                <RelativeTime value={health.lastToolCallAt} />
              ) : (
                "None yet"
              )}
            </dd>
          </div>
          {health.lastError ? (
            <div className="conn-error">
              <dt>Last error</dt>
              <dd>{health.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {children}
      {actions ? <footer className="conn-actions">{actions}</footer> : null}
    </article>
  );
}
