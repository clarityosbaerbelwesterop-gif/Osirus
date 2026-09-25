-- Meta-learning and capability synthesis (M42, M43).
--
-- Additive only. Every CHECK below is replaced by a superset of itself, so
-- every existing row still satisfies it; the new columns have defaults that
-- keep today's behaviour (an enabled skill is active, a version is active).
--
-- What becomes storable:
--   learning_artifacts.kind   + procedure, tool_candidate, meta_policy,
--                               ablation_result
--   learning_artifacts.status + quarantined
--   generation_runs.kind      + ablation, procedure_mining, tool_synthesis
--   strategy_versions.status  + quarantined
--   skill_definitions.status, skill_versions.status (candidate,
--   experimental, active, quarantined, deprecated) and
--   skill_definitions.pinned_version
--
-- Nothing here grants anything new: the Foundry tables stay system-write
-- (012), the skill tables stay system-only (004).

ALTER TABLE osirus_intel.learning_artifacts DROP CONSTRAINT IF EXISTS learning_artifacts_kind_check;
ALTER TABLE osirus_intel.learning_artifacts ADD CONSTRAINT learning_artifacts_kind_check CHECK (kind = ANY (ARRAY['strategic_memory'::text, 'procedural_memory'::text, 'causal_memory'::text, 'skill_candidate'::text, 'strategy_candidate'::text, 'eval_case'::text, 'curriculum_task'::text, 'training_example'::text, 'failure_pattern'::text, 'router_stat'::text, 'procedure'::text, 'tool_candidate'::text, 'meta_policy'::text, 'ablation_result'::text]));

ALTER TABLE osirus_intel.learning_artifacts DROP CONSTRAINT IF EXISTS learning_artifacts_status_check;
ALTER TABLE osirus_intel.learning_artifacts ADD CONSTRAINT learning_artifacts_status_check CHECK (status = ANY (ARRAY['proposed'::text, 'active'::text, 'superseded'::text, 'rejected'::text, 'quarantined'::text]));

ALTER TABLE osirus_intel.generation_runs DROP CONSTRAINT IF EXISTS generation_runs_kind_check;
ALTER TABLE osirus_intel.generation_runs ADD CONSTRAINT generation_runs_kind_check CHECK (kind = ANY (ARRAY['curriculum'::text, 'self_play'::text, 'red'::text, 'mutation'::text, 'dataset'::text, 'skill_evolution'::text, 'ablation'::text, 'procedure_mining'::text, 'tool_synthesis'::text]));

ALTER TABLE osirus_intel.strategy_versions DROP CONSTRAINT IF EXISTS strategy_versions_status_check;
ALTER TABLE osirus_intel.strategy_versions ADD CONSTRAINT strategy_versions_status_check CHECK (status = ANY (ARRAY['draft'::text, 'experimental'::text, 'verified'::text, 'champion'::text, 'canary'::text, 'active'::text, 'degraded'::text, 'rejected'::text, 'deprecated'::text, 'quarantined'::text]));

-- Skill lifecycle. A candidate or experimental skill version is loaded only
-- for a policy that names it (a Foundry trial or a canary); the product
-- loads active versions, or the pinned one.
ALTER TABLE osirus.skill_definitions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE osirus.skill_definitions ADD COLUMN IF NOT EXISTS pinned_version text;
UPDATE osirus.skill_definitions SET status = 'deprecated' WHERE enabled = false AND status = 'active';
ALTER TABLE osirus.skill_definitions DROP CONSTRAINT IF EXISTS skill_definitions_status_check;
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_status_check CHECK (status = ANY (ARRAY['candidate'::text, 'experimental'::text, 'active'::text, 'quarantined'::text, 'deprecated'::text]));

ALTER TABLE osirus.skill_versions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE osirus.skill_versions DROP CONSTRAINT IF EXISTS skill_versions_status_check;
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_status_check CHECK (status = ANY (ARRAY['candidate'::text, 'experimental'::text, 'active'::text, 'quarantined'::text, 'deprecated'::text]));

CREATE INDEX IF NOT EXISTS skill_versions_skill_status_idx
  ON osirus.skill_versions (skill_id, status, created_at DESC);
