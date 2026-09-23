"use client";

import { useEffect, useState } from "react";

type Health = {
  status: "ok" | "degraded";
  checks?: Record<string, boolean>;
};

const CHECK_LABEL: Record<string, string> = {
  auth: "sign-in",
  database: "storage",
  provider: "model provider",
};

/**
 * One line of real system state from /api/health. Nothing is shown until the
 * check answers, so the line never claims health it has not observed.
 */
export function SystemStatus() {
  const [health, setHealth] = useState<Health | null | "unreachable">(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => setHealth((await response.json()) as Health))
      .catch(() => {
        if (!controller.signal.aborted) setHealth("unreachable");
      });
    return () => controller.abort();
  }, []);

  if (health === null)
    return <span className="status-line subtle">Checking status…</span>;
  if (health === "unreachable")
    return (
      <span className="status-line">
        <span className="status-dot status-dot-warning" aria-hidden="true" />
        Status unavailable
      </span>
    );
  const failing = Object.entries(health.checks ?? {})
    .filter(([, ok]) => !ok)
    .map(([key]) => CHECK_LABEL[key] ?? key);
  return (
    <span className="status-line">
      <span
        className={`status-dot ${failing.length ? "status-dot-warning" : "status-dot-ok"}`}
        aria-hidden="true"
      />
      {failing.length ? `Degraded: ${failing.join(", ")}` : "Online"}
    </span>
  );
}
