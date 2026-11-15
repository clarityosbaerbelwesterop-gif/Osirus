// Workspace policy: what the agent may do on its own.
//
// Every tool call falls into one or more action classes. A workspace decides
// per class: allow, ask (an approval), or deny. Some classes have a floor that
// no preset or custom setting can go below -- production deploys, database
// changes, destructive and financial actions, and MCP tools always ask.
//
// The policy can only tighten the registry's built-in rule (external or
// high-risk calls need approval), with one scoped exception: a workspace may
// let the built-in delivery tool push a new branch and open a pull request
// without asking. That is reviewable and reversible; nothing else is relaxed.

import type { ToolTrust } from "../tools/registry";

export const ACTION_CLASSES = [
  "read",
  "workspace_write",
  "external_write",
  "git_push",
  "pr_create",
  "deploy_preview",
  "deploy_production",
  "db_change",
  "destructive",
  "financial",
  "mcp_action",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export type Decision = "allow" | "ask" | "deny";
export type Preset = "cautious" | "balanced" | "autonomous";

export const CLASS_INFO: Record<
  ActionClass,
  { label: string; description: string; floor: Decision | null; inUse: boolean }
> = {
  read: {
    label: "Lesen",
    description: "Dateien lesen, im Web suchen, nachschlagen.",
    floor: null,
    inUse: true,
  },
  workspace_write: {
    label: "Änderungen in der Sandbox",
    description:
      "Dateien bearbeiten und Befehle in der abgeschotteten Sandbox ausführen.",
    floor: null,
    inUse: true,
  },
  external_write: {
    label: "Externe Aktionen",
    description: "Über eine Verbindung etwas außerhalb von Osirus ändern.",
    floor: null,
    inUse: true,
  },
  git_push: {
    label: "Branches pushen",
    description:
      "Einen neuen Branch in ein verbundenes GitHub-Repository pushen.",
    floor: null,
    inUse: true,
  },
  pr_create: {
    label: "Pull Requests öffnen",
    description: "Einen Pull Request zur Prüfung öffnen.",
    floor: null,
    inUse: true,
  },
  deploy_preview: {
    label: "Vorschau-Deployments",
    description: "Eine Vorschau deployen, die nur du sehen kannst.",
    floor: null,
    inUse: false,
  },
  deploy_production: {
    label: "Produktions-Deployments",
    description: "In die Produktion deployen.",
    floor: "ask",
    inUse: false,
  },
  db_change: {
    label: "Datenbankänderungen",
    description: "Schema oder Daten einer verbundenen Datenbank ändern.",
    floor: "ask",
    inUse: false,
  },
  destructive: {
    label: "Daten löschen",
    description: "Daten außerhalb der Sandbox löschen.",
    floor: "ask",
    inUse: false,
  },
  financial: {
    label: "Geld ausgeben",
    description: "Etwas kaufen, abonnieren oder bezahlen.",
    floor: "ask",
    inUse: false,
  },
  mcp_action: {
    label: "MCP-Werkzeuge",
    description: "Ein Werkzeug auf einem verbundenen MCP-Server aufrufen.",
    floor: "ask",
    inUse: true,
  },
};

export const PRESETS: Record<Preset, Record<ActionClass, Decision>> = {
  cautious: {
    read: "allow",
    workspace_write: "ask",
    external_write: "ask",
    git_push: "ask",
    pr_create: "ask",
    deploy_preview: "ask",
    deploy_production: "ask",
    db_change: "ask",
    destructive: "ask",
    financial: "deny",
    mcp_action: "ask",
  },
  balanced: {
    read: "allow",
    workspace_write: "allow",
    external_write: "ask",
    git_push: "ask",
    pr_create: "ask",
    deploy_preview: "allow",
    deploy_production: "ask",
    db_change: "ask",
    destructive: "ask",
    financial: "deny",
    mcp_action: "ask",
  },
  autonomous: {
    read: "allow",
    workspace_write: "allow",
    external_write: "ask",
    git_push: "allow",
    pr_create: "allow",
    deploy_preview: "allow",
    deploy_production: "ask",
    db_change: "ask",
    destructive: "ask",
    financial: "deny",
    mcp_action: "ask",
  },
};

export const PRESET_INFO: Record<
  Preset,
  { label: string; description: string }
> = {
  cautious: {
    label: "Vorsichtig",
    description: "Fragt vor jeder Änderung, auch in der Sandbox.",
  },
  balanced: {
    label: "Ausgewogen",
    description:
      "Arbeitet frei in der Sandbox; fragt vor dem Pushen, vor Pull Requests und vor Aktionen anderswo.",
  },
  autonomous: {
    label: "Autonom",
    description:
      "Pusht auch neue Branches und öffnet Pull Requests ohne Rückfrage. Alles andere fragt weiterhin.",
  },
};

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

export function stricter(a: Decision, b: Decision): Decision {
  return RANK[a] >= RANK[b] ? a : b;
}

export type WorkspacePolicy = {
  preset: Preset | "custom";
  decisions: Record<ActionClass, Decision>;
};

/** Apply floors: nothing may be more permissive than its class allows. */
export function withFloors(
  decisions: Partial<Record<string, unknown>>,
  base: Record<ActionClass, Decision> = PRESETS.balanced,
): Record<ActionClass, Decision> {
  const result = {} as Record<ActionClass, Decision>;
  for (const cls of ACTION_CLASSES) {
    const raw = decisions[cls];
    const chosen: Decision =
      raw === "allow" || raw === "ask" || raw === "deny" ? raw : base[cls];
    const floor = CLASS_INFO[cls].floor;
    result[cls] = floor ? stricter(chosen, floor) : chosen;
  }
  return result;
}

export function resolvePolicy(
  preset: string | null | undefined,
  overrides: Partial<Record<string, unknown>> = {},
): WorkspacePolicy {
  if (preset === "custom")
    return { preset: "custom", decisions: withFloors(overrides) };
  const known: Preset =
    preset === "cautious" || preset === "autonomous" ? preset : "balanced";
  return { preset: known, decisions: withFloors(PRESETS[known]) };
}

/** The classes a call belongs to. */
export function classifyTool(tool: {
  id: string;
  effect: "read" | "write" | "external";
  trust: ToolTrust;
}): ActionClass[] {
  if (tool.trust === "mcp" || tool.id.startsWith("mcp:")) return ["mcp_action"];
  if (tool.id === "git.deliver" && tool.trust === "builtin")
    return ["git_push", "pr_create"];
  if (tool.effect === "read") return ["read"];
  if (tool.effect === "write") return ["workspace_write"];
  return ["external_write"];
}

/**
 * The final decision for one call: the strictest of its classes, combined
 * with the registry's built-in requirement. The built-in "ask" is relaxed only
 * for the built-in delivery tool when both of its classes are allowed.
 */
export function decide(
  policy: Record<ActionClass, Decision>,
  tool: {
    id: string;
    effect: "read" | "write" | "external";
    trust: ToolTrust;
  },
  builtinRequiresApproval: boolean,
): Decision {
  const classes = classifyTool(tool);
  const fromPolicy = classes
    .map((cls) => policy[cls])
    .reduce<Decision>((acc, value) => stricter(acc, value), "allow");
  const relaxable = tool.id === "git.deliver" && tool.trust === "builtin";
  const builtin: Decision = builtinRequiresApproval ? "ask" : "allow";
  if (relaxable && fromPolicy === "allow") return "allow";
  return stricter(fromPolicy, builtin);
}

/** Restrict a policy further, e.g. for an automation. */
export function intersect(
  a: Record<ActionClass, Decision>,
  b: Record<ActionClass, Decision>,
): Record<ActionClass, Decision> {
  const result = {} as Record<ActionClass, Decision>;
  for (const cls of ACTION_CLASSES) result[cls] = stricter(a[cls], b[cls]);
  return result;
}
