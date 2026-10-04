// What a coding run is about to do, and whether the person already said
// file edits may pass. No invented command, no second sentence.

export type CodingPermission = "ask" | "accept-edits";

export type IntentDiffLine = {
  kind: "add" | "remove";
  text: string;
};

export type IntendedAction = {
  /** Verb, for example "liest" or "führt". */
  text: string;
  /** The path or command, shown once, in code. */
  target: string;
  /** Optional closer, for example "aus". Empty when the line ends on the target. */
  tail: string;
  diff: IntentDiffLine[];
};

const DIFF_CAP = 24;

const WATCHED = new Set([
  "workspace.read",
  "workspace.write",
  "workspace.replace",
  "workspace.delete",
  "workspace.rename",
  "workspace.run",
]);

const EDIT_PASS = new Set(["workspace.write", "workspace.replace"]);

export function parseCodingPermission(value: unknown): CodingPermission {
  return value === "accept-edits" ? "accept-edits" : "ask";
}

/** Null unless this run is the coding surface. Other surfaces are not asked. */
export function codingPermissionFromInput(
  input: unknown,
): CodingPermission | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as { surface?: unknown; coding?: unknown };
  if (row.surface !== "coding") return null;
  const coding = row.coding;
  const permission =
    coding && typeof coding === "object"
      ? (coding as { permission?: unknown }).permission
      : null;
  return parseCodingPermission(permission);
}

export function passesOnAcceptEdits(toolId: string | null | undefined) {
  return Boolean(toolId && EDIT_PASS.has(toolId));
}

/**
 * Ask before a file read, a file edit, or a command on a coding run.
 * Accept-edits lets a file write or replace through. It does not loosen a deny.
 */
export function codingIntentDecision(input: {
  permission: CodingPermission | null;
  toolId: string;
}): "ask" | "allow" | null {
  if (!input.permission || !WATCHED.has(input.toolId)) return null;
  if (input.permission === "accept-edits" && EDIT_PASS.has(input.toolId))
    return "allow";
  return "ask";
}

export function applyCodingIntent(
  base: "allow" | "ask" | "deny",
  gate: "ask" | "allow" | null,
): "allow" | "ask" | "deny" {
  if (!gate || base === "deny") return base;
  return gate;
}

function clean(value: string) {
  return value.replace(/[\r\n`]/g, "").slice(0, 200);
}

function asRow(input: unknown) {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : null;
}

function commandText(row: Record<string, unknown>) {
  if (typeof row.cmd === "string" && row.cmd.trim()) {
    const args = Array.isArray(row.args)
      ? row.args.filter((item): item is string => typeof item === "string")
      : [];
    return clean([row.cmd.trim(), ...args].join(" "));
  }
  if (typeof row.commandId === "string" && row.commandId.trim())
    return clean(row.commandId.trim());
  return null;
}

function surgical(search: string, replacement: string): IntentDiffLine[] {
  const out: IntentDiffLine[] = [];
  for (const text of search.split("\n")) {
    out.push({ kind: "remove", text });
    if (out.length >= DIFF_CAP) return out;
  }
  for (const text of replacement.split("\n")) {
    out.push({ kind: "add", text });
    if (out.length >= DIFF_CAP) return out;
  }
  return out;
}

/**
 * The one line for the action that is about to run, plus a surgical diff
 * when the call is a file edit. A whole-file write is not dumped.
 */
export function intendedAction(
  toolId: string | null | undefined,
  input: unknown,
): IntendedAction | null {
  const row = asRow(input);
  if (!toolId || !row) return null;
  if (toolId === "workspace.read" && typeof row.path === "string") {
    const target = clean(row.path);
    if (!target) return null;
    return { text: "liest", target, tail: "", diff: [] };
  }
  if (toolId === "workspace.run") {
    const target = commandText(row);
    if (!target) return null;
    return { text: "führt", target, tail: "aus", diff: [] };
  }
  if (toolId === "workspace.replace" && typeof row.path === "string") {
    const target = clean(row.path);
    if (!target) return null;
    return {
      text: "ändert",
      target,
      tail: "",
      diff: surgical(String(row.search ?? ""), String(row.replacement ?? "")),
    };
  }
  if (toolId === "workspace.write" && typeof row.path === "string") {
    const target = clean(row.path);
    if (!target) return null;
    const content = typeof row.content === "string" ? row.content : "";
    const parts = content.split("\n");
    return {
      text: "schreibt",
      target,
      tail: "",
      diff:
        parts.length > DIFF_CAP
          ? []
          : parts.map((text) => ({ kind: "add" as const, text })),
    };
  }
  if (toolId === "workspace.delete" && typeof row.path === "string") {
    const target = clean(row.path);
    if (!target) return null;
    return { text: "löscht", target, tail: "", diff: [] };
  }
  if (
    toolId === "workspace.rename" &&
    typeof row.from === "string" &&
    typeof row.to === "string"
  ) {
    const target = clean(`${row.from} → ${row.to}`);
    if (!target) return null;
    return { text: "verschiebt", target, tail: "", diff: [] };
  }
  return null;
}

/** A leading slash is a command only when this surface already has that action. */
export function codingSlash(
  text: string,
): "pause" | "resume" | "accept-edits" | "ask" | "unknown" | null {
  const name = slashName(text);
  if (!name) return null;
  if (
    name === "pause" ||
    name === "resume" ||
    name === "accept-edits" ||
    name === "ask"
  )
    return name;
  return "unknown";
}

export function chatSlash(text: string): "stop" | "unknown" | null {
  const name = slashName(text);
  if (!name) return null;
  if (name === "stop") return "stop";
  return "unknown";
}

function slashName(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const name = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  return name || null;
}
