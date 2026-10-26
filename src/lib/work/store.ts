import "server-only";
import { randomUUID } from "node:crypto";
import { queryAs } from "@/lib/db/client";
import type { ProductIdentity } from "@/lib/auth/bootstrap";
import type { WorkExecution } from "./execute";
import type { WorkRecommendation } from "./recommend";
import type { WorkSelection as Selection } from "./selection";

function complexity(selection: Selection) {
  if (selection.difficulty === "S") return "low";
  if (selection.difficulty === "M") return "medium";
  return "high";
}

export async function openWorkRun(input: {
  identity: ProductIdentity;
  prompt: string;
  recommendation: WorkRecommendation;
  selection: Selection;
}) {
  const sessionId = randomUUID();
  const runId = randomUUID();
  const title = input.prompt.slice(0, 120) || "Work";
  await queryAs(
    input.identity.userId,
    `insert into osirus.sessions
       (id, organization_id, workspace_id, title, created_by, surface)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, 'work')`,
    [
      sessionId,
      input.identity.organizationId,
      input.identity.workspaceId,
      title,
      input.identity.userId,
    ],
  );
  await queryAs(
    input.identity.userId,
    `insert into osirus.runs
       (id, organization_id, workspace_id, session_id, requested_by,
        objective, primary_capability, complexity, status, input,
        difficulty_class, exec_model, reviewer_model, subagent_count,
        recommendation, user_overrides, started_at)
     values
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, 'general', $7, 'running', $8::jsonb,
        $9, $10, $11, $12,
        $13::jsonb, $14::jsonb, now())`,
    [
      runId,
      input.identity.organizationId,
      input.identity.workspaceId,
      sessionId,
      input.identity.userId,
      input.prompt,
      complexity(input.selection),
      JSON.stringify({ surface: "work" }),
      input.selection.difficulty,
      input.selection.executorModelId,
      input.selection.reviewerModelId,
      input.selection.subAgentCount,
      JSON.stringify(input.recommendation),
      JSON.stringify({
        executorSource: input.selection.executorSource,
        reviewerSource: input.selection.reviewerSource,
        subAgentSource: input.selection.subAgentSource,
      }),
    ],
  );
  return { sessionId, runId };
}

export async function finishWorkRun(input: {
  identity: ProductIdentity;
  runId: string;
  execution: WorkExecution;
}) {
  const status =
    input.execution.status === "completed" ? "completed" : "failed";
  await queryAs(
    input.identity.userId,
    `update osirus.runs
        set status = $3,
            error_code = $4,
            error_message = $5,
            completed_at = now(),
            updated_at = now()
      where id = $1::uuid and workspace_id = $2::uuid`,
    [
      input.runId,
      input.identity.workspaceId,
      status,
      input.execution.status === "completed" ? null : input.execution.status,
      input.execution.message,
    ],
  );
  for (const sub of input.execution.subagents) {
    await queryAs(
      input.identity.userId,
      `insert into osirus.subagent_runs
         (organization_id, workspace_id, run_id, ordinal, model, status,
          input_tokens, output_tokens, estimated_cost_usd, error_code)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.identity.organizationId,
        input.identity.workspaceId,
        input.runId,
        sub.index,
        sub.modelId,
        sub.status,
        sub.inputTokens,
        sub.outputTokens,
        sub.costUsd,
        sub.error,
      ],
    );
  }
  await queryAs(
    input.identity.userId,
    `insert into osirus.reviews
       (organization_id, workspace_id, run_id, reviewer_model, verdict,
        findings, estimated_cost_usd)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.runId,
      input.execution.review.modelId,
      input.execution.review.verdict,
      input.execution.review.findings,
      input.execution.review.costUsd,
    ],
  );
  return { runId: input.runId };
}

export async function recordWorkModelCall(input: {
  identity: ProductIdentity;
  runId: string;
  model: string;
  role: string;
  status: "completed" | "failed";
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  errorCode?: string | null;
}) {
  const rows = await queryAs<{ id: string }>(
    input.identity.userId,
    `insert into osirus.model_calls
       (organization_id, workspace_id, run_id, provider, model, logical_role,
        status, input_tokens, output_tokens, estimated_cost_usd, error_code,
        completed_at)
     values ($1::uuid, $2::uuid, $3::uuid, 'unorouter', $4, $5,
             $6, $7, $8, $9, $10, now())
     returning id`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.runId,
      input.model,
      input.role,
      input.status,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.costUsd ?? null,
      input.errorCode ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}
