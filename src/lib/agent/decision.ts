import { z } from "zod";

// What the model is allowed to decide.
//
// A decision is an action plus a one-line summary of it. There is no field for
// reasoning: the summary is shown to the user and stored as evidence of what
// the agent did, so it states the action, not the deliberation behind it.

export const AGENT_ACTIONS = [
  "RESPOND",
  "USE_TOOL",
  "SPAWN_WORKER",
  "RETRIEVE_MEMORY",
  "REQUEST_APPROVAL",
  "CREATE_ARTIFACT",
  "REPLAN",
  "VERIFY",
  "YIELD",
  "FINISH",
] as const;

export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const agentDecisionSchema = z.object({
  action: z.enum(AGENT_ACTIONS),
  /** One line, user-visible. What is being done, never why at length. */
  summary: z.string().min(1).max(300),
  toolId: z.string().min(1).max(160).optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  /** Ask for full input schemas before using tools. Progressive disclosure. */
  requestSchemaFor: z.array(z.string().min(1).max(160)).max(4).optional(),
  workerTask: z
    .object({
      objective: z.string().min(1).max(2000),
      capability: z.string().min(1).max(40).optional(),
    })
    .optional(),
  memoryQuery: z.string().min(1).max(500).optional(),
  artifact: z
    .object({
      title: z.string().min(1).max(200),
      kind: z.string().min(1).max(40),
      content: z.string().min(1).max(200_000),
    })
    .optional(),
  approval: z
    .object({
      action: z.string().min(1).max(200),
      risk: z.enum(["low", "medium", "high"]),
      detail: z.string().max(2000).optional(),
    })
    .optional(),
  /** The user-facing answer, required for RESPOND and FINISH. */
  answer: z.string().max(100_000).optional(),
  progress: z.number().min(0).max(1).optional(),
  /**
   * VERIFY only. Which hypotheses this evidence bears on. Absent means the
   * loop may match by statement or falsifier, and must not update every
   * open hypothesis.
   */
  hypothesisIds: z.array(z.string().min(1).max(80)).max(8).optional(),
  evidenceRelation: z.enum(["supports", "contradicts", "falsifies"]).optional(),
});

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

/**
 * Enforce the fields each action needs.
 *
 * Kept separate from the schema so a missing field produces a message the
 * model can act on ("USE_TOOL requires toolId"), which goes back into the next
 * prompt as a correction instead of failing the run.
 */
export function decisionProblems(decision: AgentDecision): string[] {
  const problems: string[] = [];
  switch (decision.action) {
    case "USE_TOOL":
      // Asking only for schemas is a complete request: the schemas are the
      // step's result, and the call follows once the model has them.
      if (!decision.toolId && !decision.requestSchemaFor?.length)
        problems.push("USE_TOOL requires toolId.");
      break;
    case "RESPOND":
    case "FINISH":
      if (!decision.answer?.trim()) {
        problems.push(`${decision.action} requires a non-empty answer.`);
      }
      break;
    case "SPAWN_WORKER":
      if (!decision.workerTask) {
        problems.push("SPAWN_WORKER requires workerTask.");
      }
      break;
    case "RETRIEVE_MEMORY":
      if (!decision.memoryQuery) {
        problems.push("RETRIEVE_MEMORY requires memoryQuery.");
      }
      break;
    case "CREATE_ARTIFACT":
      if (!decision.artifact)
        problems.push("CREATE_ARTIFACT requires artifact.");
      break;
    case "REQUEST_APPROVAL":
      if (!decision.approval) {
        problems.push("REQUEST_APPROVAL requires approval.");
      }
      break;
  }
  return problems;
}

export const DECISION_FORMAT = [
  "Reply with exactly one JSON object and nothing else:",
  "{",
  '  "action": "RESPOND|USE_TOOL|SPAWN_WORKER|RETRIEVE_MEMORY|REQUEST_APPROVAL|CREATE_ARTIFACT|REPLAN|VERIFY|YIELD|FINISH",',
  '  "summary": "one line stating what this step does",',
  '  "toolId": "only for USE_TOOL",',
  '  "toolInput": { "only for USE_TOOL": "matching the tool schema" },',
  '  "requestSchemaFor": ["tool ids whose input schema you need first"],',
  '  "workerTask": { "objective": "only for SPAWN_WORKER" },',
  '  "memoryQuery": "only for RETRIEVE_MEMORY",',
  '  "artifact": { "title": "", "kind": "", "content": "only for CREATE_ARTIFACT" },',
  '  "approval": { "action": "", "risk": "low|medium|high", "detail": "" },',
  '  "answer": "the complete user-facing answer, only for RESPOND or FINISH",',
  '  "progress": 0.0,',
  '  "hypothesisIds": ["only for VERIFY: hypothesis ids this evidence bears on"],',
  '  "evidenceRelation": "supports|contradicts|falsifies, only for VERIFY"',
  "}",
  "The summary is shown to the user. State the action; do not narrate reasoning.",
].join("\n");
