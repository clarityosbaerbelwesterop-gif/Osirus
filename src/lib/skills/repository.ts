import { queryAs, querySystem } from "../db/client";
import type { Skill } from ".";

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
  version: string | null;
  instruction: string | null;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export class SkillRepository {
  constructor(private readonly actorId: string) {}

  async loadEnabled(): Promise<Skill[]> {
    const rows = await querySystem<SkillRow>(
      `select d.id, d.slug, d.name, d.category, d.description,
              d.activation_conditions, d.risk, d.tool_needs,
              d.capability_affinity, d.estimated_context_cost,
              latest.version, latest.instruction
         from osirus.skill_definitions d
         left join lateral (
           select v.version, v.instruction
             from osirus.skill_versions v
            where v.skill_id = d.id
            order by v.created_at desc
            limit 1
         ) latest on true
        where d.enabled = true`,
    );

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      version: row.version ?? "unversioned",
      name: row.name,
      category: row.category,
      description: row.description,
      instruction: row.instruction ?? "",
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

  async recordOutcome(runId: string, outcome: "success" | "failure") {
    await queryAs(
      this.actorId,
      `update osirus.skill_usage
          set outcome = $2,
              verifier_status = case when $2 = 'success' then 'verified' else 'rejected' end
        where run_id = $1::uuid`,
      [runId, outcome],
    );
  }
}
