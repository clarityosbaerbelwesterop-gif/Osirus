"use client";

import { useEffect, useState } from "react";

/**
 * Two quota windows. Ratios and the refill sentence are display state.
 * There is no control here to buy extra credit.
 */
export function QuotaBars({
  fiveHourRatio,
  weekRatio,
  fiveHourRefill,
  note,
}: {
  fiveHourRatio: number;
  weekRatio: number;
  fiveHourRefill: string | null;
  note?: string | null;
}) {
  return (
    <div className="quota" aria-label="Kontingent">
      <QuotaBar
        label="5-Stunden-Kontingent"
        ratio={fiveHourRatio}
        refill={fiveHourRefill}
      />
      <QuotaBar label="Wochenkontingent" ratio={weekRatio} refill={null} />
      {note ? <p className="quota-note">{note}</p> : null}
    </div>
  );
}

function formatRefillSeconds(
  seconds: number | null | undefined,
): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  if (hours > 0) {
    return `Wieder verfügbar in ${hours} Std. ${minutes} Min.`;
  }
  return `Wieder verfügbar in ${minutes} Min.`;
}

export function QuotaBarsLive({ showNote = true }: { showNote?: boolean }) {
  const [state, setState] = useState<{
    fiveHourRatio: number;
    weekRatio: number;
    fiveHourRefill: string | null;
    note: string | null;
  }>({
    fiveHourRatio: PLACEHOLDER_QUOTA.fiveHourRatio,
    weekRatio: PLACEHOLDER_QUOTA.weekRatio,
    fiveHourRefill: PLACEHOLDER_QUOTA.fiveHourRefill,
    note: showNote ? PLACEHOLDER_QUOTA.note : null,
  });

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/ui-fixtures")
    ) {
      return;
    }
    let active = true;
    fetch("/api/billing/quota", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          plan?: string | null;
          retryAfterSeconds?: number | null;
          windows?: Array<{
            window: "five_hour" | "weekly";
            budgetUsd: number;
            spentUsd: number;
            exhausted: boolean;
          }>;
        };
        if (!active || !Array.isArray(data.windows)) return;
        const five = data.windows.find((w) => w.window === "five_hour");
        const week = data.windows.find((w) => w.window === "weekly");
        const fiveRatio = five
          ? five.exhausted
            ? 1
            : five.budgetUsd > 0
              ? Math.min(1, five.spentUsd / five.budgetUsd)
              : 0
          : 0;
        const weekRatio = week
          ? week.exhausted
            ? 1
            : week.budgetUsd > 0
              ? Math.min(1, week.spentUsd / week.budgetUsd)
              : 0
          : 0;
        setState({
          fiveHourRatio: fiveRatio,
          weekRatio,
          fiveHourRefill: five?.exhausted
            ? formatRefillSeconds(data.retryAfterSeconds)
            : null,
          note:
            showNote && data.plan
              ? `Tarif: ${data.plan.toUpperCase()} · Live-Kontingent aktiv.`
              : null,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [showNote]);

  return (
    <QuotaBars
      fiveHourRatio={state.fiveHourRatio}
      weekRatio={state.weekRatio}
      fiveHourRefill={state.fiveHourRefill}
      note={state.note}
    />
  );
}

function QuotaBar({
  label,
  ratio,
  refill,
}: {
  label: string;
  ratio: number;
  refill: string | null;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const empty = clamped >= 1;
  return (
    <div className="quota-row">
      <div className="quota-label">
        <span>{label}</span>
        {empty && refill ? (
          <span className="quota-refill">{refill}</span>
        ) : null}
      </div>
      <div
        className="quota-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={
          empty && refill ? `${label}, aufgebraucht. ${refill}` : label
        }
      >
        <span
          className="quota-fill"
          data-empty={empty ? "true" : "false"}
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
    </div>
  );
}

/** Placeholder window shown until quota is served by the backend. */
export const PLACEHOLDER_QUOTA = {
  fiveHourRatio: 0.15,
  weekRatio: 0.2,
  fiveHourRefill: null,
  note: "Platzhalter, bis das Kontingent vom Server kommt.",
} as const;
