import { createHash } from "node:crypto";
import type { RunOutcome } from "./compiler-v2";

// Causal extraction for Memory OS II.
//
// Events and links are derived from what the run recorded: tool outcomes,
// check runs, research evidence, and agent steps. Nothing is inferred from
// model prose. Links are action -> outcome chains the agent can use when
// deciding what to try next.

export type CausalEventKind = "action" | "outcome" | "observation";

export type CausalEvent = {
  id: string;
  kind: CausalEventKind;
  label: string;
  occurredAt: string;
  confidence: number;
  source: Record<string, unknown>;
};

export type CausalLinkType = "caused" | "preceded" | "enabled" | "contradicted";

export type CausalLink = {
  from: string;
  to: string;
  relation: CausalLinkType;
  confidence: number;
  provenance: Record<string, unknown>;
};

type CheckRun = { phase: string; command: string; exitCode: number | null };
type ToolEvidence = {
  toolId: string;
  ok: boolean;
  data?: {
    command?: string;
    exitCode?: number | null;
    analysis?: { failureClass?: string; evidence?: string } | null;
  };
};
type AgentStep = {
  index: number;
  action: string;
  toolId?: string;
  outcome: string;
  summary: string;
};

function stableId(prefix: string, value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function event(
  kind: CausalEventKind,
  label: string,
  source: Record<string, unknown>,
  confidence = 0.7,
  occurredAt?: string,
): CausalEvent {
  const at = occurredAt ?? new Date().toISOString();
  return {
    id: stableId(kind, `${label}:${at}`),
    kind,
    label: label.slice(0, 400),
    occurredAt: at,
    confidence,
    source,
  };
}

function link(
  from: string,
  to: string,
  relation: CausalLinkType,
  confidence: number,
  provenance: Record<string, unknown>,
): CausalLink {
  return { from, to, relation, confidence, provenance };
}

/**
 * Extract causal events and links from a finished run's recorded state.
 * Returns an empty graph when the run has no structured evidence.
 */
export function extractCausalGraph(outcome: RunOutcome): {
  events: CausalEvent[];
  links: CausalLink[];
} {
  const events: CausalEvent[] = [];
  const links: CausalLink[] = [];
  const runId = outcome.runId;
  const base = { runId, armId: outcome.armId };

  const repository =
    (outcome.state.workspace as { repository?: string | null } | undefined)
      ?.repository ?? null;

  // Check runs: command (action) -> exit code (outcome).
  for (const run of (outcome.state.checkRuns as CheckRun[] | undefined) ?? []) {
    const action = event(
      "action",
      repository
        ? `Ran \`${run.command}\` (${run.phase}) in ${repository}`
        : `Ran \`${run.command}\` (${run.phase})`,
      {
        ...base,
        memory: "causal.check_run",
        phase: run.phase,
        command: run.command,
      },
      0.85,
    );
    events.push(action);
    const outcomeLabel =
      run.exitCode === 0
        ? `\`${run.command}\` exited 0`
        : `\`${run.command}\` exited ${run.exitCode ?? "unknown"}`;
    const outcomeEvent = event(
      "outcome",
      outcomeLabel,
      {
        ...base,
        memory: "causal.check_outcome",
        phase: run.phase,
        exitCode: run.exitCode,
      },
      run.exitCode === 0 ? 0.9 : 0.75,
    );
    events.push(outcomeEvent);
    links.push(
      link(action.id, outcomeEvent.id, "caused", 0.9, {
        ...base,
        kind: "check_run",
      }),
    );
  }

  // Tool evidence: failure followed by success on the same command (repair chain).
  const toolRuns = (
    (outcome.state.toolEvidence as ToolEvidence[] | undefined) ?? []
  ).filter((entry) => entry.toolId === "workspace.run" && entry.data?.command);
  for (let index = 0; index < toolRuns.length; index += 1) {
    const current = toolRuns[index]!;
    const command = current.data!.command!;
    const failed = current.data!.exitCode !== 0 && current.data!.analysis;
    if (!failed) continue;
    const later = toolRuns
      .slice(index + 1)
      .find(
        (entry) =>
          entry.data?.command === command && entry.data?.exitCode === 0,
      );
    if (!later) continue;
    const failAction = event(
      "action",
      `Executed \`${command}\` (failed: ${current.data!.analysis!.failureClass})`,
      {
        ...base,
        memory: "causal.tool_failure",
        command,
        failureClass: current.data!.analysis!.failureClass,
      },
      0.8,
    );
    const failOutcome = event(
      "outcome",
      `\`${command}\` failed: ${(current.data!.analysis!.evidence ?? "").slice(0, 200)}`,
      { ...base, memory: "causal.tool_failure_outcome", command },
      0.85,
    );
    const fixAction = event(
      "action",
      `Re-ran \`${command}\` after run change`,
      { ...base, memory: "causal.tool_retry", command },
      0.75,
    );
    const passOutcome = event(
      "outcome",
      `\`${command}\` passed after change`,
      { ...base, memory: "causal.tool_success", command },
      0.9,
    );
    events.push(failAction, failOutcome, fixAction, passOutcome);
    links.push(
      link(failAction.id, failOutcome.id, "caused", 0.9, base),
      link(failOutcome.id, fixAction.id, "preceded", 0.7, base),
      link(fixAction.id, passOutcome.id, "caused", 0.85, base),
      link(failOutcome.id, passOutcome.id, "enabled", 0.6, {
        ...base,
        note: "intervention_between",
      }),
    );
  }

  // Research: retrieval (action) -> supported claim (outcome).
  const claims =
    (outcome.state.researchClaims as
      | Array<{ statement: string; status: string; confidence: number }>
      | undefined) ?? [];
  const retrieved =
    (outcome.state.retrieved as Array<{ url: string }> | undefined) ?? [];
  if (retrieved.length > 0) {
    const retrieveAction = event(
      "action",
      `Retrieved ${retrieved.length} source(s)`,
      {
        ...base,
        memory: "causal.research_retrieve",
        urls: retrieved.slice(0, 8).map((doc) => doc.url),
      },
      0.7,
    );
    events.push(retrieveAction);
    for (const claim of claims) {
      if (claim.status !== "SUPPORTED") continue;
      const claimOutcome = event(
        "outcome",
        claim.statement.slice(0, 400),
        {
          ...base,
          memory: "causal.research_claim",
          status: claim.status,
          confidence: claim.confidence,
        },
        Math.min(0.9, Math.max(0.5, claim.confidence)),
      );
      events.push(claimOutcome);
      links.push(
        link(retrieveAction.id, claimOutcome.id, "caused", 0.65, {
          ...base,
          kind: "research",
        }),
      );
    }
  }

  // Agent steps: sequential preceded-by chain for tool actions.
  const steps = (outcome.state.agentSteps as AgentStep[] | undefined) ?? [];
  let priorStepId: string | null = null;
  for (const step of steps.slice(-20)) {
    if (step.outcome !== "ok") continue;
    const stepEvent = event(
      step.action === "USE_TOOL" ? "action" : "observation",
      step.toolId
        ? `${step.action} ${step.toolId}: ${step.summary}`
        : `${step.action}: ${step.summary}`,
      {
        ...base,
        memory: "causal.agent_step",
        stepIndex: step.index,
        action: step.action,
        toolId: step.toolId ?? null,
      },
      0.6,
    );
    events.push(stepEvent);
    if (priorStepId) {
      links.push(
        link(priorStepId, stepEvent.id, "preceded", 0.5, {
          ...base,
          kind: "agent_sequence",
        }),
      );
    }
    priorStepId = stepEvent.id;
  }

  // Deduplicate events by id (repair chains may overlap with check runs).
  const byId = new Map<string, CausalEvent>();
  for (const item of events) byId.set(item.id, item);
  const uniqueEvents = [...byId.values()];

  const eventIds = new Set(uniqueEvents.map((item) => item.id));
  const uniqueLinks = links.filter(
    (item) => eventIds.has(item.from) && eventIds.has(item.to),
  );

  return { events: uniqueEvents, links: uniqueLinks };
}

/** Render causal chains as short narrative lines for the first brain. */
export function renderCausalNarrative(
  events: CausalEvent[],
  links: CausalLink[],
  limit = 6,
): string[] {
  if (events.length === 0) return [];
  const byId = new Map(events.map((item) => [item.id, item]));
  const outgoing = new Map<string, CausalLink[]>();
  for (const edge of links) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const narratives: string[] = [];
  const used = new Set<string>();

  const causalRoots = events.filter(
    (item) =>
      item.kind === "action" &&
      (outgoing.get(item.id) ?? []).some((edge) => edge.relation === "caused"),
  );

  for (const root of causalRoots) {
    if (used.has(root.id)) continue;
    const chain: string[] = [root.label];
    let current = root.id;
    const visited = new Set<string>([current]);
    while (chain.length < 4) {
      const next = (outgoing.get(current) ?? [])
        .filter(
          (edge) => edge.relation === "caused" || edge.relation === "enabled",
        )
        .sort((left, right) => right.confidence - left.confidence)[0];
      if (!next || visited.has(next.to)) break;
      const node = byId.get(next.to);
      if (!node) break;
      chain.push(node.label);
      visited.add(next.to);
      current = next.to;
    }
    if (chain.length >= 2) {
      narratives.push(chain.join(" → "));
      for (const id of visited) used.add(id);
    }
    if (narratives.length >= limit) break;
  }

  // Standalone high-confidence outcomes not yet narrated.
  for (const item of events) {
    if (narratives.length >= limit) break;
    if (used.has(item.id)) continue;
    if (item.kind === "outcome" && item.confidence >= 0.8) {
      narratives.push(item.label);
      used.add(item.id);
    }
  }

  return narratives.slice(0, limit);
}
