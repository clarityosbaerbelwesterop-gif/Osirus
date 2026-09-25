import "server-only";

import { queryAs, querySystem } from "../db/client";
import type { Skill } from ".";
import { osirusCapabilityPack } from "./capability-pack";

type SkillRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  activation_conditions: unknown;
  risk: "low" | "medium" | "high";
  tool_needs: unknown;
  capability_affinity: unknown;
  estimated_context_cost: number;
  priority: "P0" | "P1";
  version: string | null;
  instruction: string | null;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

let seededCapabilityPack = false;

async function ensureCapabilityPackSeeded() {
  if (seededCapabilityPack) return;
  const counts = await querySystem<{ count: string }>(
    `select count(*)::text as count
       from osirus.skill_definitions
      where source ->> 'pack' = 'Osirus_Capability_Pack_v0.1'`,
  );
  if (Number(counts[0]?.count ?? 0) < osirusCapabilityPack.length) {
    const seed = osirusCapabilityPack.map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
      description: skill.description,
      activation: skill.activation,
      priority: skill.priority,
      risk: skill.risk,
      requiredTools: skill.requiredTools,
      capabilities: skill.capabilities,
      contextCost: skill.contextCost,
      source: skill.source,
      version: skill.version,
      instruction: skill.instruction,
    }));
    await querySystem(
      `insert into osirus.skill_definitions
         (id, slug, name, category, description, activation_conditions, priority,
          risk, tool_needs, capability_affinity, estimated_context_cost, source, enabled)
       select id, slug, name, category, description, activation::jsonb, priority,
              risk, required_tools::jsonb, capabilities::jsonb, context_cost, source::jsonb, true
         from jsonb_to_recordset($1::jsonb) as skill(
           id text, slug text, name text, category text, description text,
           activation text, priority text, risk text, required_tools text,
           capabilities text, context_cost integer, source text,
           version text, instruction text
         )
       on conflict do nothing`,
      [
        JSON.stringify(
          seed.map((skill) => ({
            id: skill.id,
            slug: skill.slug,
            name: skill.name,
            category: skill.category,
            description: skill.description,
            activation: JSON.stringify(skill.activation),
            priority: skill.priority,
            risk: skill.risk,
            required_tools: JSON.stringify(skill.requiredTools),
            capabilities: JSON.stringify(skill.capabilities),
            context_cost: skill.contextCost,
            source: JSON.stringify(skill.source),
          })),
        ),
      ],
    );
    await querySystem(
      `insert into osirus.skill_versions (skill_id, version, instruction, source)
       select id, version, instruction, source::jsonb
         from jsonb_to_recordset($1::jsonb) as skill(
           id text, version text, instruction text, source text
         )
       on conflict (skill_id, version) do nothing`,
      [
        JSON.stringify(
          seed.map((skill) => ({
            id: skill.id,
            version: skill.version,
            instruction: skill.instruction,
            source: JSON.stringify(skill.source),
          })),
        ),
      ],
    );
  }
  seededCapabilityPack = true;
}

export class SkillRepository {
  constructor(private readonly actorId: string) {}

  /**
   * Skills a run may use. The product gets active skills at their pinned or
   * newest active version (M43). A policy that names candidate versions
   * ("skillId@version": a Foundry trial or a canary) also gets those; a
   * quarantined skill or version is never loaded.
   */
  async loadEnabled(options: { include?: string[] } = {}): Promise<Skill[]> {
    await ensureCapabilityPackSeeded();
    const rows = await querySystem<SkillRow>(
      `select d.id, d.slug, d.name, d.category, d.description,
              d.activation_conditions, d.risk, d.tool_needs,
              d.capability_affinity, d.estimated_context_cost,
              d.priority,
              latest.version, latest.instruction
         from osirus.skill_definitions d
         left join lateral (
           select v.version, v.instruction
             from osirus.skill_versions v
            where v.skill_id = d.id
              and v.status = 'active'
              and (d.pinned_version is null or v.version = d.pinned_version)
            order by v.created_at desc
            limit 1
         ) latest on true
        where d.enabled = true and d.status = 'active'
       union all
       select d.id, d.slug, d.name, d.category, d.description,
              d.activation_conditions, d.risk, d.tool_needs,
              d.capability_affinity, d.estimated_context_cost,
              d.priority, v.version, v.instruction
         from osirus.skill_definitions d
         join osirus.skill_versions v on v.skill_id = d.id
        where d.id || '@' || v.version = any($1::text[])
          and d.status <> 'quarantined'
          and v.status in ('candidate', 'experimental', 'active')`,
      [options.include ?? []],
    );

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      version: row.version ?? "unversioned",
      name: row.name,
      category: row.category,
      description: row.description,
      instruction: row.instruction ?? "",
      priority: row.priority,
      capabilities: stringArray(row.capability_affinity),
      activation: stringArray(row.activation_conditions),
      risk: row.risk,
      requiredTools: stringArray(row.tool_needs),
      contextCost: row.estimated_context_cost,
      state: "enabled" as const,
    }));
  }

  async recordSelection(input: {
    organizationId: string;
    workspaceId: string;
    runId: string;
    stageId?: string | null;
    skill: Skill;
    score: number;
  }) {
    await queryAs(
      this.actorId,
      `insert into osirus.skill_usage
         (organization_id, workspace_id, run_id, stage_id,
          skill_id, skill_version, selection_score, outcome,
          verifier_status, repair_rounds, tool_call_count)
       values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5, $6, $7, 'pending', 'unverified', 0, 0)`,
      [
        input.organizationId,
        input.workspaceId,
        input.runId,
        input.stageId ?? null,
        input.skill.id,
        input.skill.version,
        input.score,
      ],
    );
  }

  /**
   * How often each skill was selected and then verified.
   *
   * Feeds the ranking's history term. Only verified outcomes count as
   * success: a run that finished is not the same as a run that was right, and
   * ranking on completion would reward whatever is cheapest to finish.
   */
  async outcomeWeights(workspaceId: string) {
    const rows = await queryAs<{
      skill_id: string;
      selections: string | number;
      verified: string | number;
    }>(
      this.actorId,
      `select skill_id,
              count(*) as selections,
              count(*) filter (where verifier_status = 'verified') as verified
         from osirus.skill_usage
        where workspace_id = $1::uuid
          and created_at > now() - interval '90 days'
        group by skill_id
       having count(*) >= 3`,
      [workspaceId],
    );
    const weights: Record<string, number> = {};
    for (const row of rows) {
      const selections = Number(row.selections);
      if (selections <= 0) continue;
      weights[row.skill_id] = Number(row.verified) / selections;
    }
    return weights;
  }

  /**
   * Write what a stage actually cost and how it was judged.
   *
   * These columns existed from 003 and were always 0 or null, which made every
   * quality metric unanswerable. Skills are selected in one stage and judged
   * in the verify stage, so the verdict applies to every selection of the
   * run, not to rows of the judging stage (which never had any).
   * recordOutcome below only fills in what no stage verdict has set.
   */
  async recordStageTelemetry(input: {
    runId: string;
    stageId: string;
    verifierStatus: "unverified" | "verified" | "conflicted" | "rejected";
    latencyMs?: number | null;
    tokenCost?: number | null;
    toolCallCount?: number;
    repairRounds?: number;
  }) {
    await queryAs(
      this.actorId,
      `update osirus.skill_usage
          set verifier_status = $3,
              outcome = case when $3 = 'verified' then 'success' else 'failure' end,
              latency_ms = coalesce($4, latency_ms),
              token_cost = coalesce($5, token_cost),
              tool_call_count = greatest(tool_call_count, $6),
              repair_rounds = greatest(repair_rounds, $7)
        where run_id = $1::uuid
          and ($2::uuid is not null)`,
      [
        input.runId,
        input.stageId,
        input.verifierStatus,
        input.latencyMs ?? null,
        input.tokenCost ?? null,
        Math.max(0, input.toolCallCount ?? 0),
        Math.max(0, input.repairRounds ?? 0),
      ],
    );
  }

  async recordOutcome(runId: string, outcome: "success" | "failure") {
    await queryAs(
      this.actorId,
      `update osirus.skill_usage
          set outcome = $2,
              verifier_status = case
                when verifier_status <> 'unverified' then verifier_status
                when $2 = 'success' then 'verified'
                else 'rejected'
              end
        where run_id = $1::uuid`,
      [runId, outcome],
    );
  }
}
