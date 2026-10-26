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

/** Fired after any model call so the bars refresh at once. */
export const USAGE_EVENT = "osirus:usage";

export function notifyUsage() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(USAGE_EVENT));
}

type QuotaPayload = {
  plan?: string | null;
  retryAfterSeconds?: number | null;
  windows?: Array<{
    window: string;
    budgetUsd: number;
    spentUsd: number;
    exhausted: boolean;
    retryAfterSeconds?: number;
  }>;
};

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  developer: "Developer",
  ultra_100: "Ultra 100",
  ultra_200: "Ultra 200",
};

function ratioOf(window?: {
  budgetUsd: number;
  spentUsd: number;
  exhausted: boolean;
}) {
  if (!window) return 0;
  if (window.exhausted) return 1;
  return window.budgetUsd > 0
    ? Math.min(1, window.spentUsd / window.budgetUsd)
    : 0;
}

/**
 * The person's two windows, live: loaded on mount, after every model call
 * (USAGE_EVENT), when the tab returns and once a minute.
 */
export function QuotaBarsLive({ showNote = true }: { showNote?: boolean }) {
  const [state, setState] = useState<{
    fiveHourRatio: number;
    weekRatio: number;
    fiveHourRefill: string | null;
    note: string | null;
  } | null>(null);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/ui-fixtures")
    ) {
      return;
    }
    let active = true;
    const load = () =>
      fetch("/api/billing/quota", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as QuotaPayload;
          if (!active || !Array.isArray(data.windows)) return;
          // The server names the windows "fiveHour" and "weekly".
          const five = data.windows.find(
            (w) => w.window === "fiveHour" || w.window === "five_hour",
          );
          const week = data.windows.find((w) => w.window === "weekly");
          setState({
            fiveHourRatio: ratioOf(five),
            weekRatio: ratioOf(week),
            fiveHourRefill: five?.exhausted
              ? formatRefillSeconds(
                  five.retryAfterSeconds ?? data.retryAfterSeconds,
                )
              : week?.exhausted
                ? formatRefillSeconds(
                    week.retryAfterSeconds ?? data.retryAfterSeconds,
                  )
                : null,
            note:
              showNote && data.plan
                ? `${PLAN_LABEL[data.plan] ?? data.plan}-Plan`
                : null,
          });
        })
        .catch(() => undefined);
    void load();
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(USAGE_EVENT, load);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.removeEventListener(USAGE_EVENT, load);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [showNote]);

  return (
    <QuotaBars
      fiveHourRatio={state?.fiveHourRatio ?? 0}
      weekRatio={state?.weekRatio ?? 0}
      fiveHourRefill={state?.fiveHourRefill ?? null}
      note={state?.note ?? null}
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
        {!empty ? (
          <span className="quota-percent tabular">
            {Math.round(clamped * 100)} %
          </span>
        ) : null}
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
