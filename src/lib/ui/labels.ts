// Plain-language labels for runtime vocabulary.
//
// The runtime speaks in ids (arm ids, stage statuses, tool ids, failure
// classes). People should not have to. Everything the interface shows about a
// run goes through here, so the words stay consistent from screen to screen.

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const ARM_LABEL: Record<string, string> = {
  general: "General",
  thinking: "Analysis",
  coding: "Coding",
  research: "Research",
  math_science: "Math & science",
  building: "Building",
};

export function armLabel(armId: string | null | undefined) {
  if (!armId) return "General";
  return ARM_LABEL[armId] ?? humanize(armId);
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Starting", tone: "accent" },
  planning: { label: "Planning", tone: "accent" },
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Working", tone: "accent" },
  waiting_for_approval: { label: "Needs your approval", tone: "warning" },
  verifying: { label: "Verifying", tone: "accent" },
  repairing: { label: "Repairing", tone: "accent" },
  blocked: { label: "Waiting", tone: "warning" },
  cancelling: { label: "Cancelling", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  completed: { label: "Completed", tone: "success" },
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
  pending: "Pending",
  running: "In progress",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

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
  "git.deliver": "Push a branch to GitHub",
  "attachments.search": "Search the attached files",
  "computer.inspect": "Use the app in a browser",
  "world.query": "Look up what this workspace knows",
  "vercel.deployments": "List Vercel deployments",
  "neon.projects": "List Neon projects",
  "supabase.projects": "List Supabase projects",
  "sandbox.preview": "Start a preview server",
  "sandbox.write": "Write a file in the sandbox",
  "sandbox.read": "Read a file in the sandbox",
  "sandbox.list": "List sandbox files",
  "compute.run": "Run a computation",
  "data.analyze": "Analyze data",
  "research.search": "Search the web",
  "research.read": "Read a web page",
  "research.sources": "List sources",
  "workspace.tree": "List repository files",
  "workspace.read": "Read a repository file",
  "workspace.search": "Search the repository",
  "workspace.write": "Write a repository file",
  "workspace.replace": "Edit a repository file",
  "workspace.delete": "Delete a repository file",
  "workspace.rename": "Rename a repository file",
  "workspace.diff": "Show the changes",
  "workspace.commands": "List the repository's commands",
  "workspace.run": "Run a command",
  "workspace.analyze_failure": "Analyze a failing check",
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
  read: "Reads data only",
  write: "Changes files inside the isolated sandbox",
  external: "Acts outside Osirus, on a system you connected",
};

export function effectLabel(effect: string | null | undefined) {
  return EFFECT_LABEL[effect ?? ""] ?? "Effect not declared";
}

const RISK: Record<string, { label: string; tone: Tone }> = {
  low: { label: "Low risk", tone: "neutral" },
  medium: { label: "Medium risk", tone: "warning" },
  high: { label: "High risk", tone: "danger" },
  critical: { label: "Critical risk", tone: "danger" },
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
  return byClass?.message ?? byError?.message ?? "This step failed.";
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
    return "Model capacity is reserved for interactive requests right now. This work resumes automatically.";
  if (/rate_limit|rate limited|rate-limit|\b429\b/.test(text))
    return "The model provider is limiting requests right now. The run waits and retries automatically; you can also try again in a few minutes.";
  if (
    /provider_unavailable|bad_response_status_code|unavailable|\b503\b|\b502\b/.test(
      text,
    )
  )
    return "The model provider is temporarily unavailable. The run can be retried; no work was lost.";
  // A permanent refusal says the provider will not serve this deployment at
  // all until something changes on the account: the message must not claim a
  // temporary outage will fix it (OSIRUS-01).
  if (/insufficient_credit|balance|credit|\b402\b|quota exceeded/.test(text))
    return "The model provider declined the request because the account's free quota or credit is exhausted. This is not a temporary outage and no work was lost: the run can be retried once provider access is restored. If you keep seeing this, contact the operator.";
  if (/credential_rejected|unauthorized|\b401\b|\b403\b/.test(text))
    return "The model provider rejected the deployment's credentials. This needs an operator to fix; retrying will not help.";
  if (/model_not_configured|provider_not_configured/.test(text))
    return "The model runtime is missing a configuration value. This needs an operator to fix; retrying will not help.";
  return null;
}

function genericFailureText(raw: string): string | null {
  const text = raw.toLowerCase();
  if (!text.trim()) return null;
  if (/timeout|timed out|wall_clock/.test(text))
    return "This step ran out of time.";
  if (/budget/.test(text)) return "This run reached its budget.";
  if (/approval_rejected|rejected/.test(text))
    return "An action was rejected, so this step stopped.";
  if (/agent_loop_exhausted|bound_reached/.test(text))
    return "Osirus could not finish this step within its limits.";
  if (/cancel/.test(text)) return "This step was cancelled.";
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
    if (ahead < 60) return "in under a minute";
    if (ahead < 3600) return `in ${Math.round(ahead / 60)}m`;
    if (ahead < 86_400) return `in ${Math.round(ahead / 3600)}h`;
    return `in ${Math.round(ahead / 86_400)}d`;
  }
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
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
