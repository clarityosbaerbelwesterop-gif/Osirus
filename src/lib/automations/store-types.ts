import type { Schedule } from "./schedule";

export type TriggerKind = "schedule" | "run_completed" | "connector_changed";

export type AutomationView = {
  id: string;
  name: string;
  objective: string;
  trigger: TriggerKind;
  schedule: Schedule | null;
  scheduleLabel: string | null;
  policyPreset: "cautious" | "balanced";
  maxCostUsd: number | null;
  maxTokens: number | null;
  allowedTools: string[];
  notifyOn: string[];
  enabled: boolean;
  sessionId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: string | null;
};
