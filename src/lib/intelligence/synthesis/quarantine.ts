import type { IntelStore } from "../store/store";
import type { LearningArtifact, StrategyVersion } from "../types";

// Quarantine (M43). When a canary rolls back, or credit assignment ties a
// regression to a synthesized skill or tool, that item is taken out of
// service with its evidence: its status becomes "quarantined", the last
// good version is pinned again, the promotion log keeps the evidence, and
// a repair hypothesis goes on the agenda. Nothing is deleted.

export type QuarantineTarget =
  | { kind: "tool"; artifact: LearningArtifact }
  | { kind: "skill"; skillId: string; version: string };

export async function quarantine(
  store: IntelStore,
  input: {
    target: QuarantineTarget;
    reason: string;
    evidence: Record<string, unknown>;
    strategyVersionId: string | null;
    capabilityId: string | null;
    pinSkill?: (skillId: string, version: string) => Promise<string | null>;
  },
) {
  const { target } = input;
  let label: string;
  let pinned: string | null = null;
  if (target.kind === "tool") {
    await store.upsertArtifact({ ...target.artifact, status: "quarantined" });
    label = String(target.artifact.content.id ?? target.artifact.taskPattern);
  } else {
    label = `${target.skillId}@${target.version}`;
    pinned = input.pinSkill
      ? await input.pinSkill(target.skillId, target.version)
      : await quarantineSkillVersion(target.skillId, target.version);
  }
  if (input.strategyVersionId)
    await store.insertPromotion({
      strategyVersionId: input.strategyVersionId,
      fromStatus: "canary",
      toStatus: "quarantined",
      canaryPercent: 0,
      evidence: {
        ...input.evidence,
        quarantined: label,
        reason: input.reason,
        pinned,
      },
    });
  if (input.capabilityId)
    await store.upsertAgendaItem({
      capabilityId: input.capabilityId,
      title: `Repair quarantined ${target.kind} ${label}`,
      rationale: `${input.reason}. The previous version is back in service${pinned ? ` (${pinned})` : ""}; a revised candidate has to beat it in paired trials.`,
      score: 0.7,
      components: { weakness: 0.7, usefulness: 0.6, potential: 0.8, cost: 0.3 },
      status: "open",
    });
  return { label, pinned };
}

/**
 * The skill side, in the skill tables: the version is quarantined and the
 * definition pins the newest version that is still active.
 */
export async function quarantineSkillVersion(skillId: string, version: string) {
  const { querySystem } = await import("../../db/client");
  const rows = await querySystem<{ pinned: string | null }>(
    `with q as (
       update osirus.skill_versions set status = 'quarantined'
        where skill_id = $1 and version = $2
       returning skill_id
     ), previous as (
       select v.version from osirus.skill_versions v
        where v.skill_id = $1 and v.version <> $2 and v.status = 'active'
        order by v.created_at desc limit 1
     )
     update osirus.skill_definitions d
        set pinned_version = (select version from previous),
            status = case when (select version from previous) is null
                          then 'quarantined' else d.status end,
            updated_at = now()
      where d.id = $1 and exists (select 1 from q)
     returning d.pinned_version as pinned`,
    [skillId, version],
  );
  return rows[0]?.pinned ?? null;
}

/** What a rolled-back strategy version carried that was synthesized. */
export function synthesizedParts(version: StrategyVersion) {
  return {
    tools: version.genome.tools?.include ?? [],
    skills: version.genome.skills?.include ?? [],
  };
}
