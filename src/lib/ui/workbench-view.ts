import type { RunSnapshot } from "../runtime/types";
import { list, obj, str } from "./records";

// Which workbench views a run has something to show in.
//
// The workbench groups its views (Run, Build, Knowledge, System) and shows a
// view only when the run produced data for it. A plain conversation has none
// of the build or knowledge views, so the workbench stays closed for it.

export type WorkbenchTab =
  | "activity"
  | "plan"
  | "workers"
  | "files"
  | "diff"
  | "terminal"
  | "preview"
  | "research"
  | "memory"
  | "artifacts"
  | "skills"
  | "tools"
  | "verification";

export type WorkbenchGroup = {
  id: "run" | "build" | "knowledge" | "system";
  label: string;
  tabs: Array<{ id: WorkbenchTab; label: string }>;
};

export const WORKBENCH_GROUPS: WorkbenchGroup[] = [
  {
    id: "run",
    label: "Run",
    tabs: [
      { id: "activity", label: "Activity" },
      { id: "plan", label: "Plan" },
      { id: "workers", label: "Workers" },
    ],
  },
  {
    id: "build",
    label: "Build",
    tabs: [
      { id: "files", label: "Files" },
      { id: "diff", label: "Diff" },
      { id: "terminal", label: "Terminal" },
      { id: "preview", label: "Preview" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    tabs: [
      { id: "research", label: "Sources" },
      { id: "memory", label: "Memory" },
      { id: "artifacts", label: "Artifacts" },
    ],
  },
  {
    id: "system",
    label: "System",
    tabs: [
      { id: "skills", label: "Skills" },
      { id: "tools", label: "Tools" },
      { id: "verification", label: "Checks" },
    ],
  },
];

const BUILD_ARMS = new Set(["coding", "building"]);

export function isToolEvent(type: string, data: Record<string, unknown>) {
  return (
    type.startsWith("sandbox.") ||
    type.startsWith("tool.") ||
    type.startsWith("workspace.") ||
    (type === "agent.step" && typeof data.toolId === "string")
  );
}

export function relevantTabs(snapshot: RunSnapshot | null): Set<WorkbenchTab> {
  const tabs = new Set<WorkbenchTab>();
  if (!snapshot) return tabs;
  const events = snapshot.events;
  const has = (prefix: string) =>
    events.some((event) => event.type.startsWith(prefix));
  const routing = obj(snapshot.run.acceptanceContract, "routing");
  const arms = new Set([
    snapshot.run.armId ?? "",
    ...list(routing, "composition").map(String),
  ]);

  tabs.add("activity");
  if (snapshot.stages.length) tabs.add("plan");
  if (snapshot.attempts.length) tabs.add("workers");

  const building = [...arms].some((arm) => BUILD_ARMS.has(arm));
  if (building || has("workspace.") || has("sandbox.")) {
    tabs.add("files");
    tabs.add("diff");
    tabs.add("terminal");
    tabs.add("preview");
  }
  if (arms.has("research") || has("research.")) tabs.add("research");
  if (has("memory.retrieved")) tabs.add("memory");
  if (snapshot.artifacts.length) tabs.add("artifacts");
  if (has("skill.selected")) tabs.add("skills");
  if (events.some((event) => isToolEvent(event.type, event.data)))
    tabs.add("tools");
  if (snapshot.stages.some((stage) => str(stage, "verifier_status")))
    tabs.add("verification");
  return tabs;
}

/** Groups with at least one relevant view, each keeping only those views. */
export function visibleGroups(snapshot: RunSnapshot | null): WorkbenchGroup[] {
  const tabs = relevantTabs(snapshot);
  return WORKBENCH_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => tabs.has(tab.id)),
  })).filter((group) => group.tabs.length > 0);
}

/**
 * Whether the workbench should open on its own for this run: when there is
 * something to look at beyond the conversation itself.
 */
export function autoOpenWorkbench(snapshot: RunSnapshot | null) {
  if (!snapshot) return false;
  const tabs = relevantTabs(snapshot);
  return tabs.has("files") || tabs.has("research");
}

/** The view to land on when the workbench opens for a run. */
export function defaultTab(snapshot: RunSnapshot | null): WorkbenchTab {
  const tabs = relevantTabs(snapshot);
  if (tabs.has("files") && snapshot?.run.status === "completed") return "diff";
  if (tabs.has("research") && snapshot?.run.status === "completed")
    return "research";
  return "activity";
}
