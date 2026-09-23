import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";

// Quality metrics for one workspace, counted from what the runtime recorded.
//
// Definitions, shown next to the numbers:
//   success          -- run status completed
//   verified success -- completed, and every verified stage says verified
//   false completion -- completed although a stage verdict was rejected or
//                       conflicted (the run finished on evidence against it)
//   repair rate      -- runs whose plan was revised at least once
//   resume rate      -- runs that yielded a slice and later completed
// Skill numbers are correlations: a skill used on runs that verified did not
// necessarily cause the verification. Nothing here claims otherwise.

export type QualityWindow = 7 | 30;

const toNumber = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

const RUN_FLAGS = `
  with scoped as (
    select r.id, r.status, r.arm_id, r.created_at, r.completed_at
      from osirus.runs r
     where r.workspace_id = $1::uuid
       and r.created_at > now() - make_interval(days => $2::int)
  ), flags as (
    select s.*,
           exists (select 1 from osirus.run_stages x
                    where x.run_id = s.id and x.verifier_status is not null) as has_verdict,
           not exists (select 1 from osirus.run_stages x
                        where x.run_id = s.id and x.verifier_status is not null
                          and x.verifier_status <> 'verified') as all_verified,
           exists (select 1 from osirus.run_stages x
                    where x.run_id = s.id
                      and x.verifier_status in ('rejected', 'conflicted')) as contradicted,
           exists (select 1 from osirus.run_events e
                    where e.run_id = s.id and e.type = 'plan.revised') as repaired,
           exists (select 1 from osirus.run_events e
                    where e.run_id = s.id and e.type = 'slice.yielded') as yielded
      from scoped s
  )`;

export type RunQuality = {
  runs: number;
  completed: number;
  failed: number;
  verified: number;
  falseCompletions: number;
  repaired: number;
  yielded: number;
  resumed: number;
  successRate: number | null;
  verifiedRate: number | null;
  falseCompletionRate: number | null;
  repairRate: number | null;
  resumeRate: number | null;
};

export type ModelQuality = {
  calls: number;
  failures: number;
  failureRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  tokens: number;
  costUsd: number;
};

export type ArmRow = {
  arm: string;
  runs: number;
  successRate: number | null;
  verifiedRate: number | null;
  falseCompletions: number;
  medianDurationMs: number | null;
};

export type SkillRow = {
  skill: string;
  selections: number;
  verifiedShare: number | null;
  medianLatencyMs: number | null;
  tokens: number;
};

export type ToolRow = {
  tool: string;
  source: "builtin" | "github" | "mcp";
  calls: number;
  successRate: number | null;
  refused: number;
  p50LatencyMs: number | null;
  topError: string | null;
};

export type ModelRoleRow = {
  role: string;
  model: string;
  calls: number;
  tokens: number;
  costUsd: number;
  p50LatencyMs: number | null;
  failureRate: number | null;
  verifiedOutcome: number | null;
};

export async function runQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<RunQuality> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `${RUN_FLAGS}
     select count(*)::int as runs,
            count(*) filter (where status = 'completed')::int as completed,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where status = 'completed' and has_verdict and all_verified)::int as verified,
            count(*) filter (where status = 'completed' and contradicted)::int as false_completions,
            count(*) filter (where repaired)::int as repaired,
            count(*) filter (where yielded)::int as yielded,
            count(*) filter (where yielded and status = 'completed')::int as resumed
       from flags`,
    [identity.workspaceId, days],
  ).catch(() => []);
  const row = rows[0] ?? {};
  const runs = toNumber(row.runs);
  const completed = toNumber(row.completed);
  const yielded = toNumber(row.yielded);
  return {
    runs,
    completed,
    failed: toNumber(row.failed),
    verified: toNumber(row.verified),
    falseCompletions: toNumber(row.false_completions),
    repaired: toNumber(row.repaired),
    yielded,
    resumed: toNumber(row.resumed),
    successRate: rate(completed, runs),
    verifiedRate: rate(toNumber(row.verified), runs),
    falseCompletionRate: rate(toNumber(row.false_completions), completed),
    repairRate: rate(toNumber(row.repaired), runs),
    resumeRate: rate(toNumber(row.resumed), yielded),
  };
}

export async function modelQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<ModelQuality> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `select count(*)::int as calls,
            count(*) filter (where status = 'failed')::int as failures,
            percentile_cont(0.5) within group (order by latency_ms)
              filter (where status = 'completed') as p50,
            percentile_cont(0.95) within group (order by latency_ms)
              filter (where status = 'completed') as p95,
            coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint as tokens,
            coalesce(sum(estimated_cost_usd), 0) as cost
       from osirus.model_calls
      where workspace_id = $1::uuid
        and created_at > now() - make_interval(days => $2::int)`,
    [identity.workspaceId, days],
  ).catch(() => []);
  const row = rows[0] ?? {};
  const calls = toNumber(row.calls);
  return {
    calls,
    failures: toNumber(row.failures),
    failureRate: rate(toNumber(row.failures), calls),
    p50LatencyMs:
      row.p50 === null || row.p50 === undefined ? null : toNumber(row.p50),
    p95LatencyMs:
      row.p95 === null || row.p95 === undefined ? null : toNumber(row.p95),
    tokens: toNumber(row.tokens),
    costUsd: toNumber(row.cost),
  };
}

export async function armQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<ArmRow[]> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `${RUN_FLAGS}
     select coalesce(arm_id, 'general') as arm,
            count(*)::int as runs,
            count(*) filter (where status = 'completed')::int as completed,
            count(*) filter (where status = 'completed' and has_verdict and all_verified)::int as verified,
            count(*) filter (where status = 'completed' and contradicted)::int as false_completions,
            percentile_cont(0.5) within group (
              order by extract(epoch from (completed_at - created_at)) * 1000
            ) filter (where completed_at is not null) as median_ms
       from flags
      group by 1
      order by runs desc`,
    [identity.workspaceId, days],
  ).catch(() => []);
  return rows.map((row) => ({
    arm: String(row.arm),
    runs: toNumber(row.runs),
    successRate: rate(toNumber(row.completed), toNumber(row.runs)),
    verifiedRate: rate(toNumber(row.verified), toNumber(row.runs)),
    falseCompletions: toNumber(row.false_completions),
    medianDurationMs:
      row.median_ms === null || row.median_ms === undefined
        ? null
        : toNumber(row.median_ms),
  }));
}

export async function skillQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<SkillRow[]> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `select skill_id as skill,
            count(*)::int as selections,
            count(*) filter (where verifier_status = 'verified')::int as verified,
            count(*) filter (where verifier_status <> 'unverified')::int as judged,
            percentile_cont(0.5) within group (order by latency_ms) as median_ms,
            coalesce(sum(token_cost), 0)::bigint as tokens
       from osirus.skill_usage
      where workspace_id = $1::uuid
        and created_at > now() - make_interval(days => $2::int)
      group by skill_id
      order by selections desc
      limit 30`,
    [identity.workspaceId, days],
  ).catch(() => []);
  return rows.map((row) => ({
    skill: String(row.skill),
    selections: toNumber(row.selections),
    verifiedShare: rate(toNumber(row.verified), toNumber(row.judged)),
    medianLatencyMs:
      row.median_ms === null || row.median_ms === undefined
        ? null
        : toNumber(row.median_ms),
    tokens: toNumber(row.tokens),
  }));
}

export async function toolQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<ToolRow[]> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `select tool_name as tool,
            count(*)::int as calls,
            count(*) filter (where status = 'completed')::int as completed,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where status = 'cancelled')::int as refused,
            percentile_cont(0.5) within group (order by latency_ms)
              filter (where status = 'completed') as p50,
            mode() within group (order by error_code)
              filter (where error_code is not null) as top_error
       from osirus.tool_calls
      where workspace_id = $1::uuid
        and created_at > now() - make_interval(days => $2::int)
      group by tool_name
      order by calls desc
      limit 40`,
    [identity.workspaceId, days],
  ).catch(() => []);
  return rows.map((row) => {
    const tool = String(row.tool);
    return {
      tool,
      source: tool.startsWith("mcp:")
        ? ("mcp" as const)
        : tool === "git.deliver" || tool.startsWith("github.")
          ? ("github" as const)
          : ("builtin" as const),
      calls: toNumber(row.calls),
      successRate: rate(
        toNumber(row.completed),
        toNumber(row.completed) + toNumber(row.failed),
      ),
      refused: toNumber(row.refused),
      p50LatencyMs:
        row.p50 === null || row.p50 === undefined ? null : toNumber(row.p50),
      topError: typeof row.top_error === "string" ? row.top_error : null,
    };
  });
}

export async function modelRoleQuality(
  identity: ProductIdentity,
  days: QualityWindow,
): Promise<ModelRoleRow[]> {
  const rows = await queryAs<Record<string, unknown>>(
    identity.userId,
    `${RUN_FLAGS}
     select m.logical_role as role, m.model,
            count(*)::int as calls,
            coalesce(sum(coalesce(m.input_tokens, 0) + coalesce(m.output_tokens, 0)), 0)::bigint as tokens,
            coalesce(sum(m.estimated_cost_usd), 0) as cost,
            percentile_cont(0.5) within group (order by m.latency_ms)
              filter (where m.status = 'completed') as p50,
            count(*) filter (where m.status = 'failed')::int as failures,
            count(distinct f.id) filter (where f.status = 'completed' and f.has_verdict and f.all_verified)::int as verified_runs,
            count(distinct f.id)::int as runs
       from osirus.model_calls m
       left join flags f on f.id = m.run_id
      where m.workspace_id = $1::uuid
        and m.created_at > now() - make_interval(days => $2::int)
      group by m.logical_role, m.model
      order by calls desc`,
    [identity.workspaceId, days],
  ).catch(() => []);
  return rows.map((row) => ({
    role: String(row.role),
    model: String(row.model),
    calls: toNumber(row.calls),
    tokens: toNumber(row.tokens),
    costUsd: toNumber(row.cost),
    p50LatencyMs:
      row.p50 === null || row.p50 === undefined ? null : toNumber(row.p50),
    failureRate: rate(toNumber(row.failures), toNumber(row.calls)),
    verifiedOutcome: rate(toNumber(row.verified_runs), toNumber(row.runs)),
  }));
}
