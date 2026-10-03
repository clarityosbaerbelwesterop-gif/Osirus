import { EFFORTS, type EffortId } from "./surfaces";

/**
 * Picks a coding effort. A level the person chose is returned unchanged.
 * Otherwise the level is only a suggestion from the task: what was asked,
 * whether tools are needed, and an explicit ask to think harder or go lighter.
 * This is not a scheduler.
 */
export type EffortRoute = {
  effort: EffortId;
  source: "chosen" | "suggested";
};

const HARDER =
  /\b(think harder|go deeper|more carefully|maximum effort|gruendlicher|gründlicher|höchster aufwand|hoechster aufwand)\b|\beffort[:= ]+ultra\b|\bultra effort\b/i;
const LIGHTER =
  /\b(go lighter|keep it (?:light|simple)|don'?t overthink|do not overthink|leichter|quick pass)\b|\beffort[:= ]+leicht\b|\blight effort\b/i;

/** Whether the task asks for repository work, not merely a question. */
export function codingToolsNeeded(task: string) {
  return /\b(fix|edit|change|add|implement|refactor|test|patch|commit|rename|migrate|update|write|delete|bug|failing|repository|file|branch)\b/i.test(
    task,
  );
}

/**
 * The person's task, without the repository URL and branch the coding page
 * appends when it starts a run. Those lines are not what was asked.
 */
export function taskForEffort(objective: string) {
  const lines = objective.split("\n");
  const urlAt = lines.findIndex((line) =>
    /^https:\/\/github\.com\/\S+$/.test(line.trim()),
  );
  if (urlAt === -1) return objective.trim();
  const kept = lines.filter(
    (_, index) => index !== urlAt && index !== urlAt + 1,
  );
  const text = kept.join("\n").trim();
  return text || objective.trim();
}

function explicitEffort(task: string): EffortId | null {
  const harderAt = task.search(HARDER);
  const lighterAt = task.search(LIGHTER);
  if (harderAt === -1 && lighterAt === -1) return null;
  if (harderAt === -1) return "leicht";
  if (lighterAt === -1) return "ultra";
  return lighterAt > harderAt ? "leicht" : "ultra";
}

function baseIndex(task: string) {
  const text = task.trim();
  if (
    text.length > 700 ||
    /\b(refactor|migrat|architect|redesign|across the|whole (repo|repository))\b/i.test(
      text,
    )
  ) {
    return 3;
  }
  if (
    text.length > 220 ||
    /\b(bug|failing|stack ?trace|investigate)\b/i.test(text)
  ) {
    return 2;
  }
  if (text.length < 48) return 0;
  return 1;
}

export function routeCodingEffort(input: {
  chosen: EffortId | null;
  task: string;
  toolsNeeded: boolean;
}): EffortRoute {
  if (input.chosen) return { effort: input.chosen, source: "chosen" };
  const explicit = explicitEffort(input.task);
  if (explicit) return { effort: explicit, source: "suggested" };
  let index = baseIndex(input.task);
  // Tools lift a light task. A task that is already substantial stays put
  // unless the person asked to think harder.
  if (input.toolsNeeded && index < 2) index += 1;
  return { effort: EFFORTS[index] ?? "mittel", source: "suggested" };
}
