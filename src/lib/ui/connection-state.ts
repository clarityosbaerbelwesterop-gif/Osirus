import type { Tone } from "./labels";

// Connection states as people see them. "Connected" means a credential is
// stored and was accepted when it was added; whether it works now is the
// separate health line, which only a real check can make green.

export type ConnectionState =
  "CONNECTED" | "DEGRADED" | "EXPIRED" | "NOT_CONNECTED" | "NOT_CONFIGURED";

export type HealthLike = {
  last: { ok: boolean; error: string | null; checkedAt: string } | null;
};

export function githubState(
  status: "CONNECTED" | "NOT_CONNECTED" | "NOT_CONFIGURED",
  health: HealthLike | null,
): ConnectionState {
  if (status !== "CONNECTED") return status;
  const last = health?.last;
  if (!last || last.ok) return "CONNECTED";
  return /no longer accepts|401|expired|revoked/i.test(last.error ?? "")
    ? "EXPIRED"
    : "DEGRADED";
}

export function mcpState(server: {
  status: "unchecked" | "healthy" | "degraded" | "failed";
  lastError: string | null;
}): ConnectionState {
  if (server.status === "failed")
    return /rejected the credentials/i.test(server.lastError ?? "")
      ? "EXPIRED"
      : "DEGRADED";
  if (server.status === "degraded") return "DEGRADED";
  return "CONNECTED";
}

export const STATE_LABEL: Record<
  ConnectionState,
  { label: string; tone: Tone }
> = {
  CONNECTED: { label: "Verbunden", tone: "success" },
  DEGRADED: { label: "Eingeschränkt", tone: "warning" },
  EXPIRED: { label: "Abgelaufen", tone: "danger" },
  NOT_CONNECTED: { label: "Nicht verbunden", tone: "neutral" },
  NOT_CONFIGURED: { label: "Nicht eingerichtet", tone: "neutral" },
};

/** The health line: never green without a successful check. */
export function healthLine(health: HealthLike | null) {
  const last = health?.last;
  if (!last) return { label: "Noch nicht geprüft", tone: "neutral" as Tone };
  return last.ok
    ? { label: "Funktioniert", tone: "success" as Tone }
    : { label: "Fehlerhaft", tone: "danger" as Tone };
}
