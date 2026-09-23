import { effectLabel, humanize, risk, toolLabel, type Tone } from "./labels";
import { iso, obj, str, type Row } from "./records";

// What a person needs to decide an approval, derived from the stored request.
//
// The request carries the tool, its declared effect and the exact input that
// will run (inside the fingerprint). None of it is shown as JSON: the input is
// flattened into labelled values, secrets are withheld, and long values are
// cut. Nothing here decides anything; decisions go through the API.

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
  status: "requested" | "approved" | "rejected" | "expired" | "cancelled";
  statusLabel: string;
  decidable: boolean;
  createdAt: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
};

const SECRET_KEY =
  /token|secret|password|passwd|authorization|api[_-]?key|credential|cookie|private/i;
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
  requested: "Waiting for you",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

function flatten(
  input: unknown,
  prefix = "",
  out: Array<{ label: string; value: string }> = [],
) {
  if (out.length >= 8) return out;
  if (input === null || input === undefined) return out;
  if (typeof input !== "object") {
    const value = String(input);
    out.push({
      label: humanize(prefix || "value"),
      value: value.length > 240 ? `${value.slice(0, 240)}…` : value,
    });
    return out;
  }
  if (Array.isArray(input)) {
    const primitives = input.filter(
      (item) => typeof item !== "object" || item === null,
    );
    if (primitives.length === input.length) {
      const joined = primitives.map(String).join(", ");
      out.push({
        label: humanize(prefix || "values"),
        value: joined.length > 240 ? `${joined.slice(0, 240)}…` : joined,
      });
    } else {
      out.push({
        label: humanize(prefix || "items"),
        value: `${input.length} items`,
      });
    }
    return out;
  }
  for (const [key, value] of Object.entries(input as Row)) {
    if (SECRET_KEY.test(key)) {
      out.push({ label: humanize(key), value: "Withheld" });
      continue;
    }
    if (key === "content" && typeof value === "string") {
      out.push({
        label: "Content",
        value: `${value.split("\n").length} lines`,
      });
      continue;
    }
    flatten(value, prefix ? `${prefix} ${key}` : key, out);
    if (out.length >= 8) break;
  }
  return out;
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
    status,
    statusLabel: STATUS_LABEL[status] ?? humanize(status),
    decidable: status === "requested",
    createdAt: iso(row, "created_at"),
    decidedAt: iso(row, "decided_at"),
    expiresAt,
  };
}
