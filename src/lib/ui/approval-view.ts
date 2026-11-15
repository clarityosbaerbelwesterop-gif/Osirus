import { intendedAction, type IntendedAction } from "../coding/intent";
import { effectLabel, humanize, risk, toolLabel, type Tone } from "./labels";
import { iso, obj, str, type Row } from "./records";

// What a person needs to decide an approval, derived from the stored request.
//
// The request carries the tool, its declared effect and the exact input that
// will run (inside the fingerprint). None of it is shown as JSON: the input is
// flattened into labelled values and secrets are withheld. Nothing here
// decides anything; decisions go through the API.
//
// A tool call can come from text the model read (a web page, a file), so the
// card must not let anything slip past the person: a long value shows its
// end too (where an appended "; curl … | sh" would sit), more fields than fit
// are announced, not dropped, and only secret-looking strings are withheld
// (a "private: false" on a new repository is the decision itself).

export type ApprovalView = {
  id: string;
  runId: string | null;
  stageId: string | null;
  toolId: string | null;
  title: string;
  why: string | null;
  scope: string;
  target: string | null;
  riskLevel: string;
  riskLabel: string;
  riskTone: Tone;
  details: Array<{ label: string; value: string }>;
  /** The one coding action this approval is for, or null when it is not one. */
  intent: IntendedAction | null;
  status: "requested" | "approved" | "rejected" | "expired" | "cancelled";
  statusLabel: string;
  decidable: boolean;
  createdAt: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
};

const SECRET_KEY =
  /token|secret|password|passwd|authorization|api[_-]?key|credential|cookie|private[_-]?key/i;

/** Fields shown before the card says how many more there are. */
const MAX_DETAILS = 24;
/** Values up to this length are shown whole; longer ones keep both ends. */
const FULL_VALUE = 600;
const VALUE_END = 280;
const TARGET_KEYS = [
  "repository",
  "repo",
  "branch",
  "url",
  "path",
  "command",
  "title",
  "target",
];

const STATUS_LABEL: Record<ApprovalView["status"], string> = {
  requested: "Wartet auf dich",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  expired: "Abgelaufen",
  cancelled: "Abgebrochen",
};

// Input keys the approval card names in German; other keys are humanized.
const DETAIL_LABEL: Record<string, string> = {
  repository: "Repository",
  repo: "Repository",
  branch: "Branch",
  url: "URL",
  path: "Pfad",
  command: "Befehl",
  title: "Titel",
  target: "Ziel",
  message: "Nachricht",
  body: "Text",
  name: "Name",
  description: "Beschreibung",
  query: "Suchanfrage",
  owner: "Inhaber",
};

function detailLabel(key: string) {
  return DETAIL_LABEL[key] ?? humanize(key);
}

/** A long value keeps its start and its end; the middle is counted. */
export function clip(value: string) {
  if (value.length <= FULL_VALUE) return value;
  const skipped = value.length - 2 * VALUE_END;
  return `${value.slice(0, VALUE_END)} … (${skipped} Zeichen ausgelassen) … ${value.slice(-VALUE_END)}`;
}

/** Withheld only when the key names a secret and the value looks like one. */
function isSecret(key: string, value: unknown) {
  return (
    SECRET_KEY.test(key) &&
    typeof value === "string" &&
    value.length >= 8 &&
    !/\s/.test(value)
  );
}

type Detail = { label: string; value: string };

function collect(input: unknown, prefix: string, out: Detail[]) {
  if (input === null || input === undefined) return;
  if (typeof input !== "object") {
    out.push({
      label: detailLabel(prefix || "Wert"),
      value: clip(String(input)),
    });
    return;
  }
  if (Array.isArray(input)) {
    const primitives = input.filter(
      (item) => typeof item !== "object" || item === null,
    );
    if (primitives.length === input.length) {
      out.push({
        label: detailLabel(prefix || "Werte"),
        value: clip(primitives.map(String).join(", ")),
      });
    } else {
      input.forEach((item, index) =>
        collect(item, `${prefix || "Eintrag"} ${index + 1}`, out),
      );
    }
    return;
  }
  for (const [key, value] of Object.entries(input as Row)) {
    const label = prefix ? `${prefix} ${key}` : key;
    if (isSecret(key, value)) {
      out.push({ label: detailLabel(label), value: "Zurückgehalten" });
      continue;
    }
    if (key === "content" && typeof value === "string") {
      out.push({
        label: prefix ? detailLabel(label) : "Inhalt",
        value: `${value.split("\n").length} Zeilen: ${clip(value)}`,
      });
      continue;
    }
    collect(value, label, out);
  }
}

/**
 * Every value of the input, labelled. When there are more than fit, the
 * last entry says how many were left out, so nothing disappears unseen.
 */
function flatten(input: unknown): Detail[] {
  const all: Detail[] = [];
  collect(input, "", all);
  if (all.length <= MAX_DETAILS) return all;
  const shown = all.slice(0, MAX_DETAILS - 1);
  shown.push({
    label: "Achtung",
    value: `${all.length - shown.length} weitere Angaben nicht angezeigt. Lehne ab, wenn du nicht alles prüfen kannst.`,
  });
  return shown;
}

function parseInput(request: Row | null): unknown {
  const fingerprint = str(request, "fingerprint");
  if (!fingerprint) return null;
  try {
    const parsed = JSON.parse(fingerprint) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? ((parsed as Row).input ?? null)
      : null;
  } catch {
    return null;
  }
}

export function approvalView(row: Row, now = Date.now()): ApprovalView {
  const request = obj(row, "request");
  const toolId =
    str(request, "toolId") ?? str(row, "action")?.replace(/^tool:/, "") ?? null;
  const input = parseInput(request);
  const details = flatten(input);
  const inputRow =
    typeof input === "object" && input !== null ? (input as Row) : null;
  const targetKey = TARGET_KEYS.find(
    (key) => typeof inputRow?.[key] === "string",
  );
  const target = targetKey ? String(inputRow![targetKey]).slice(0, 200) : null;
  const level = str(row, "risk") ?? "high";
  const riskInfo = risk(level);
  const expiresAt = iso(row, "expires_at");
  const rawStatus = (str(row, "status") ??
    "requested") as ApprovalView["status"];
  const expired =
    rawStatus === "requested" &&
    expiresAt !== null &&
    Date.parse(expiresAt) <= now;
  const status = expired ? "expired" : rawStatus;
  return {
    id: str(row, "id") ?? "",
    runId: str(row, "run_id"),
    stageId: str(row, "stage_id"),
    toolId,
    title: toolLabel(toolId, str(request, "title") ?? undefined),
    why: str(request, "reason") ?? str(request, "summary"),
    scope: effectLabel(str(request, "effect")),
    target,
    riskLevel: level,
    riskLabel: riskInfo.label,
    riskTone: riskInfo.tone,
    details,
    intent: intendedAction(toolId, input),
    status,
    statusLabel: STATUS_LABEL[status] ?? humanize(status),
    decidable: status === "requested",
    createdAt: iso(row, "created_at"),
    decidedAt: iso(row, "decided_at"),
    expiresAt,
  };
}
