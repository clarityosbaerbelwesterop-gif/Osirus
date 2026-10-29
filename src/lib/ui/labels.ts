// Plain-language labels for runtime vocabulary.
//
// The runtime speaks in ids (arm ids, stage statuses, tool ids, failure
// classes). People should not have to. Everything the interface shows about a
// run goes through here, so the words stay consistent from screen to screen.

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const ARM_LABEL: Record<string, string> = {
  general: "Allgemein",
  thinking: "Analyse",
  coding: "Code",
  research: "Recherche",
  math_science: "Mathematik & Naturwissenschaft",
  building: "Bauen",
};

export function armLabel(armId: string | null | undefined) {
  if (!armId) return "Allgemein";
  return ARM_LABEL[armId] ?? humanize(armId);
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Startet", tone: "accent" },
  planning: { label: "Plant", tone: "accent" },
  queued: { label: "In der Warteschlange", tone: "neutral" },
  running: { label: "Arbeitet", tone: "accent" },
  waiting_for_approval: { label: "Wartet auf deine Freigabe", tone: "warning" },
  verifying: { label: "Prüft", tone: "accent" },
  repairing: { label: "Bessert nach", tone: "accent" },
  blocked: { label: "Wartet", tone: "warning" },
  cancelling: { label: "Wird abgebrochen", tone: "neutral" },
  cancelled: { label: "Abgebrochen", tone: "neutral" },
  failed: { label: "Fehlgeschlagen", tone: "danger" },
  completed: { label: "Fertig", tone: "success" },
};

export function runStatus(status: string | null | undefined) {
  return (
    RUN_STATUS[status ?? ""] ?? {
      label: humanize(status ?? "unknown"),
      tone: "neutral" as Tone,
    }
  );
}

export type StageState =
  "pending" | "running" | "waiting" | "done" | "failed" | "skipped";

/** Collapses the runtime's stage statuses into what a person tracks. */
export function stageState(status: string | null | undefined): StageState {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
    case "blocked":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
    case "cancelled":
      return "skipped";
    default:
      return "pending";
  }
}

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  pending: "Ausstehend",
  running: "Läuft",
  waiting: "Wartet",
  done: "Erledigt",
  failed: "Fehlgeschlagen",
  skipped: "Übersprungen",
};

const STAGE_LABEL: Record<string, string> = {
  "Ground the objective": "Ziel verstehen",
  "Understand objective": "Ziel verstehen",
  "Retrieve internal context": "Kontext abrufen",
  "Retrieve relevant context": "Kontext abrufen",
  "Select skills": "Fähigkeiten wählen",
  "Select progressive skills": "Fähigkeiten wählen",
  "Plan execution": "Vorgehen planen",
  "Prepare execution plan": "Vorgehen planen",
  "Model the task and plan it": "Aufgabe erfassen und planen",
  "Ground the coding task": "Code-Aufgabe verstehen",
  "Ground coding task": "Code-Aufgabe verstehen",
  "Open the coding workspace": "Arbeitsumgebung öffnen",
  "Produce the answer": "Antwort erarbeiten",
  "Execute response": "Antwort erarbeiten",
  "Verify the result": "Ergebnis prüfen",
  "Verify response contract": "Ergebnis prüfen",
  "Verify the analysis": "Analyse prüfen",
  "Verify against the acceptance contract": "Gegen die Anforderungen prüfen",
  "Verify against the acceptance contract again":
    "Erneut gegen die Anforderungen prüfen",
  "Run the repository's checks": "Prüfungen des Repositorys ausführen",
  "Save and stop the workspace": "Arbeitsumgebung sichern und schließen",
  "Preview and browser QA": "Vorschau und Browser-Test",
  "Present the analysis": "Analyse aufbereiten",
  "Analyse the task": "Aufgabe analysieren",
  "Parse the problem": "Problem erfassen",
  "Parse math or science problem": "Problem erfassen",
  "Formalize the problem": "Problem formalisieren",
  "Design the deliverable": "Ergebnis entwerfen",
  "Decompose research question": "Forschungsfrage zerlegen",
  "Inspect data objective": "Datenziel prüfen",
  "Understand computer-use objective": "Ziel im Browser verstehen",
  "Understand multimodal objective": "Ziel verstehen",
};

const ACTIVITY_LABEL: Record<string, string> = {
  Planning: "Plant den Lauf",
  "Planned the run": "Lauf geplant",
  "Planned the research": "Recherche geplant",
  "Selected capabilities": "Fähigkeiten ausgewählt",
  "Selected skills": "Vorgehen ausgewählt",
  "Searched memory": "Gedächtnis durchsucht",
  "Task analysed": "Aufgabe analysiert",
  "Calling model": "Fragt das Modell",
  "Model response received": "Antwort des Modells erhalten",
  "Answer ready": "Antwort steht",
  "A critic reviewed the answer": "Ein Prüfer hat die Antwort gegengelesen",
  Completed: "Fertig",
  Failed: "Fehlgeschlagen",
  Cancelled: "Abgebrochen",
  "Waiting for approval": "Wartet auf Freigabe",
};

/** A runtime activity line in the person's language; free text stays. */
export function activityLabel(summary: string) {
  const known = ACTIVITY_LABEL[summary];
  if (known) return known;
  const workspace = summary.match(/^Workspace ready with (.+)$/);
  if (workspace) return `Arbeitsumgebung bereit: ${workspace[1]}`;
  return summary;
}

/** A stage name as a person reads it; unknown names stay as written. */
export function stageLabel(name: string) {
  return STAGE_LABEL[name] ?? name;
}

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  conflicted: { label: "Conflicting evidence", tone: "warning" },
  unverified: { label: "Not verified", tone: "neutral" },
};

export function verdict(status: string | null | undefined) {
  return (
    VERDICT[status ?? ""] ?? {
      label: humanize(status ?? "unknown"),
      tone: "neutral" as Tone,
    }
  );
}

const TOOL_LABEL: Record<string, string> = {
  "git.deliver": "Branch zu GitHub pushen",
  "attachments.search": "Angehängte Dateien durchsuchen",
  "computer.inspect": "App im Browser bedienen",
  "world.query": "Wissen des Workspace abfragen",
  "vercel.deployments": "Vercel-Deployments auflisten",
  "neon.projects": "Neon-Projekte auflisten",
  "supabase.projects": "Supabase-Projekte auflisten",
  "sandbox.preview": "Vorschau-Server starten",
  "sandbox.write": "Datei in der Sandbox schreiben",
  "sandbox.read": "Datei in der Sandbox lesen",
  "sandbox.list": "Dateien der Sandbox auflisten",
  "compute.run": "Berechnung ausführen",
  "data.analyze": "Daten analysieren",
  "research.search": "Im Web suchen",
  "research.read": "Webseite lesen",
  "research.sources": "Quellen auflisten",
  "workspace.tree": "Dateien des Repositorys auflisten",
  "workspace.read": "Datei im Repository lesen",
  "workspace.search": "Repository durchsuchen",
  "workspace.write": "Datei im Repository schreiben",
  "workspace.replace": "Datei im Repository bearbeiten",
  "workspace.delete": "Datei im Repository löschen",
  "workspace.rename": "Datei im Repository umbenennen",
  "workspace.diff": "Änderungen anzeigen",
  "workspace.commands": "Befehle des Repositorys auflisten",
  "workspace.run": "Befehl ausführen",
  "workspace.analyze_failure": "Fehlgeschlagene Prüfung analysieren",
  "github.repos": "GitHub-Repositories auflisten",
  "github.repo": "GitHub-Repository ansehen",
  "github.file": "Datei auf GitHub lesen",
  "github.repo.create": "GitHub-Repository anlegen",
  "github.file.write": "Datei auf GitHub schreiben",
  "github.pull_request": "Pull Request öffnen",
  "github.issue": "Issue anlegen",
  "bots.list": "Bots des Workspace auflisten",
  "bots.ask": "Einen Bot fragen",
  "code.handoff": "Aufgabe an Code übergeben",
};

export function toolLabel(toolId: string | null | undefined, title?: string) {
  if (!toolId) return title ?? "Tool";
  if (toolId.startsWith("mcp:")) {
    const [server, name] = toolId.slice(4).split("/");
    return `${humanize(name ?? toolId)} (MCP · ${server})`;
  }
  return (
    TOOL_LABEL[toolId] ?? title ?? humanize(toolId.split(".").pop() ?? toolId)
  );
}

const EFFECT_LABEL: Record<string, string> = {
  read: "Liest nur Daten",
  write: "Ändert Dateien in der abgeschotteten Sandbox",
  external: "Wirkt außerhalb von Osirus, auf einem verbundenen System",
};

export function effectLabel(effect: string | null | undefined) {
  return EFFECT_LABEL[effect ?? ""] ?? "Wirkung nicht angegeben";
}

const RISK: Record<string, { label: string; tone: Tone }> = {
  low: { label: "Geringes Risiko", tone: "neutral" },
  medium: { label: "Mittleres Risiko", tone: "warning" },
  high: { label: "Hohes Risiko", tone: "danger" },
  critical: { label: "Kritisches Risiko", tone: "danger" },
};

export function risk(level: string | null | undefined) {
  return RISK[level ?? ""] ?? RISK.high;
}

/**
 * What went wrong, in words that say what happens next. Provider internals
 * (keys, hosts, request ids) are never included.
 */
export function failureMessage(
  failureClass: string | null | undefined,
  lastError?: string | null,
) {
  // The failure class names the failure that actually stopped the step. It
  // is classified on its own first: the error text may mention an earlier,
  // superseded failure (e.g. the primary model's credit refusal before the
  // free fallback was rate limited), and that must not win (M49 section 9).
  // Provider categories outrank generic step outcomes: a loop that ran out
  // because every call was rate limited was stopped by the rate limit.
  const byClass = classifyFailureText(failureClass ?? "");
  if (byClass?.provider) return byClass.message;
  const byError = classifyFailureText(lastError ?? "");
  if (byError?.provider) return byError.message;
  return (
    byClass?.message ?? byError?.message ?? "Dieser Schritt ist fehlgeschlagen."
  );
}

function classifyFailureText(
  raw: string,
): { message: string; provider: boolean } | null {
  const provider = providerFailureText(raw);
  if (provider) return { message: provider, provider: true };
  const generic = genericFailureText(raw);
  return generic ? { message: generic, provider: false } : null;
}

function providerFailureText(raw: string): string | null {
  const text = raw.toLowerCase();
  if (!text.trim()) return null;
  // Rate limits and outages are checked before credit: a report line such as
  // "Primary x: insufficient_credit / Fallback y: rate_limited" ends in a
  // transient failure and must be described as one.
  if (/capacity_deferred/.test(text))
    return "Die Modellkapazität ist gerade für direkte Anfragen reserviert. Diese Arbeit geht automatisch weiter.";
  if (/rate_limit|rate limited|rate-limit|\b429\b/.test(text))
    return "Der Modellanbieter drosselt gerade die Anfragen. Der Lauf wartet und versucht es automatisch erneut; du kannst es auch in ein paar Minuten noch einmal probieren.";
  if (
    /provider_unavailable|bad_response_status_code|unavailable|\b503\b|\b502\b/.test(
      text,
    )
  )
    return "Der Modellanbieter ist vorübergehend nicht erreichbar. Der Lauf kann wiederholt werden; es ging keine Arbeit verloren.";
  // A permanent refusal says the provider will not serve this deployment at
  // all until something changes on the account: the message must not claim a
  // temporary outage will fix it (OSIRUS-01).
  if (/insufficient_credit|balance|credit|\b402\b|quota exceeded/.test(text))
    return "Der Modellanbieter hat die Anfrage abgelehnt, weil das Kontingent oder Guthaben des Kontos aufgebraucht ist. Das ist keine vorübergehende Störung, und es ging keine Arbeit verloren: Der Lauf kann wiederholt werden, sobald der Zugang wieder besteht. Wenn das öfter passiert, wende dich an den Betreiber.";
  if (/credential_rejected|unauthorized|\b401\b|\b403\b/.test(text))
    return "Der Modellanbieter hat die Zugangsdaten abgelehnt. Das muss der Betreiber beheben; ein neuer Versuch hilft nicht.";
  if (/model_not_configured|provider_not_configured/.test(text))
    return "Der Modellumgebung fehlt eine Einstellung. Das muss der Betreiber beheben; ein neuer Versuch hilft nicht.";
  return null;
}

function genericFailureText(raw: string): string | null {
  const text = raw.toLowerCase();
  if (!text.trim()) return null;
  if (/timeout|timed out|wall_clock/.test(text))
    return "Für diesen Schritt hat die Zeit nicht gereicht.";
  if (/budget/.test(text)) return "Dieser Lauf hat sein Budget erreicht.";
  if (/approval_rejected|rejected/.test(text))
    return "Eine Aktion wurde abgelehnt, deshalb hat dieser Schritt angehalten.";
  if (/agent_loop_exhausted|bound_reached/.test(text))
    return "Osirus konnte diesen Schritt nicht innerhalb seiner Grenzen abschließen.";
  if (/action_left_task|task_left/.test(text))
    return "Die Code-Aufgabe hat angehalten, weil eine Aktion die Aufgabe verlassen hat.";
  if (/cancel/.test(text)) return "Dieser Schritt wurde abgebrochen.";
  return null;
}

export function humanize(id: string) {
  const text = id.replace(/[_\-.]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : id;
}

export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0)
    return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) {
    const ahead = -seconds;
    if (ahead < 60) return "in unter einer Minute";
    if (ahead < 3600) return `in ${Math.round(ahead / 60)} Min.`;
    if (ahead < 86_400) return `in ${Math.round(ahead / 3600)} Std.`;
    return `in ${Math.round(ahead / 86_400)} Tagen`;
  }
  if (seconds < 45) return "gerade eben";
  if (seconds < 3600)
    return `vor ${Math.max(1, Math.round(seconds / 60))} Min.`;
  if (seconds < 86_400) return `vor ${Math.round(seconds / 3600)} Std.`;
  if (seconds < 7 * 86_400) return `vor ${Math.round(seconds / 86_400)} Tagen`;
  return new Date(at).toISOString().slice(0, 10);
}

export function formatCount(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatUsd(value: number) {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
