import {
  classifyTool,
  stricter,
  type ActionClass,
  type Decision,
} from "./model";
import type { ToolTrust } from "../tools/registry";

// Task autonomy for the Rouge Agent: the person approves the task, not every
// step of it. Within the task the agent works on its own -- pull requests,
// issues, branches, previews, files on a work branch. It still asks before
// what matters: anything on a protected class (production deploy, database,
// deleting, money), a built-in high-risk action, a write straight to a
// repository's main branch, and the first call of each third-party (MCP)
// tool in the task. A workspace "deny" is never loosened.

export type TaskAutonomy = "task" | "ask";

const PROTECTED: ReadonlySet<ActionClass> = new Set([
  "deploy_production",
  "db_change",
  "destructive",
  "financial",
]);

const MAIN_BRANCHES = new Set(["main", "master", "trunk", "production"]);

/** The task's autonomy, for Rouge Agent runs only; null elsewhere. */
export function taskAutonomyFromInput(input: unknown): TaskAutonomy | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as { surface?: unknown; autonomy?: unknown };
  if (row.surface !== "agent") return null;
  return row.autonomy === "task" ? "task" : "ask";
}

type Tool = {
  id: string;
  effect: "read" | "write" | "external";
  risk: "low" | "medium" | "high";
  trust: ToolTrust;
};

/** A call that matters enough to ask about even inside an approved task. */
export function importantCall(tool: Tool, input: unknown): boolean {
  if (classifyTool(tool).some((cls) => PROTECTED.has(cls))) return true;
  if (tool.trust !== "mcp" && tool.risk === "high") return true;
  if (tool.id === "github.file.write") {
    const branch =
      input && typeof input === "object"
        ? (input as { branch?: unknown }).branch
        : undefined;
    // No branch means the repository's default branch.
    if (typeof branch !== "string" || !branch.trim()) return true;
    if (MAIN_BRANCHES.has(branch.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * The decision for one call under the task's autonomy. `base` is what the
 * workspace policy and the built-in rule decided on their own.
 */
export function taskAutonomyDecision(input: {
  autonomy: TaskAutonomy | null;
  tool: Tool;
  callInput: unknown;
  base: Decision;
}): Decision {
  if (input.autonomy !== "task" || input.base === "deny") return input.base;
  // Third-party tools: asked once per task; the approval gate lets the
  // task's later calls of the same reviewed tool through.
  if (input.tool.trust === "mcp") return stricter(input.base, "ask");
  if (importantCall(input.tool, input.callInput))
    return stricter(input.base, "ask");
  return "allow";
}
