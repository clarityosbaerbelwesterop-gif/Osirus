import type { InteractionPreference } from "../lab/choices";
import type { RunSnapshot } from "../runtime/types";
import { stageState } from "./labels";
import { str } from "./records";
import { isToolEvent } from "./workbench-view";

/**
 * Activity the composer may show. Only states that are happening:
 * waiting on a request, typing a streamed answer, a tool that is the
 * current step, or a subagent whose stage is running. Policy phases and
 * finished steps are not a thinking animation.
 */

export type LivePill = {
  readonly kind: "tool" | "subagent";
  readonly id: string;
  readonly label: string;
};

const LIVE_ATTEMPT = new Set(["running", "claimed"]);

export function liveAgentPills(input: {
  interaction: InteractionPreference;
  snapshot: RunSnapshot | null;
}): LivePill[] {
  if (input.interaction !== "agent" || !input.snapshot) return [];
  const running = input.snapshot.stages.flatMap((stage, index) => {
    const id = str(stage, "id") ?? String(index);
    if (stageState(str(stage, "status")) !== "running") return [];
    return [{ id, name: str(stage, "name") ?? "Subagent" }];
  });
  if (!running.length) return [];
  const runningIds = new Set(running.map((stage) => stage.id));
  const pills: LivePill[] = [];
  const latest = input.snapshot.events.at(-1);
  if (
    latest &&
    latest.visibility === "user" &&
    isToolEvent(latest.type, latest.data)
  ) {
    pills.push({ kind: "tool", id: latest.id, label: latest.summary });
  }
  for (const attempt of input.snapshot.attempts) {
    const stageId = str(attempt, "stage_id");
    const status = str(attempt, "status") ?? "";
    if (!stageId || !runningIds.has(stageId) || !LIVE_ATTEMPT.has(status)) {
      continue;
    }
    const name =
      running.find((stage) => stage.id === stageId)?.name ?? "Subagent";
    pills.push({
      kind: "subagent",
      id: str(attempt, "id") ?? stageId,
      label: name,
    });
  }
  return pills;
}
