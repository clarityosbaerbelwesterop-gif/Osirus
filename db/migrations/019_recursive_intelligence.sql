-- Hourly Recursive Intelligence Cycle (M44–M48).
--
-- Additive only. One new table, rsi_cycles, driven by the existing scheduler
-- tick under the same rules as the pulse (016): a lease decides who steps a
-- cycle, the phase cursor moves only from the value the caller read, and
-- only the system writes; operators read. This is not a second scheduler.
--
-- Every CHECK below is replaced by a superset of itself, so every existing
-- row still satisfies it:
--   learning_artifacts.kind   + failure_memory, anti_pattern,
--                               benchmark_result, code_hypothesis,
--                               live_order, rollup
--   resource_ledger.category  + rsi_model_calls
--
-- Nothing here grants anything new to anyone but the app role, and the
-- app role gets no DELETE on the new table.

CREATE TABLE IF NOT EXISTS osirus_intel.rsi_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phases text[] NOT NULL,
  cursor integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  lease_owner text,
  lease_expires_at timestamp with time zone,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  next_due_at timestamp with time zone,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT rsi_cycles_status_check CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'abandoned'::text])),
  CONSTRAINT rsi_cycles_cursor_check CHECK (cursor >= 0 AND cursor <= cardinality(phases))
);

CREATE UNIQUE INDEX IF NOT EXISTS rsi_cycles_one_running_idx
  ON osirus_intel.rsi_cycles ((status)) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS rsi_cycles_started_idx
  ON osirus_intel.rsi_cycles (started_at DESC);

ALTER TABLE osirus_intel.rsi_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.rsi_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY rsi_cycles_read ON osirus_intel.rsi_cycles
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY rsi_cycles_write ON osirus_intel.rsi_cycles
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE ON osirus_intel.rsi_cycles TO osirus_app;
-- The database's default privileges give the app role every table verb.
-- No cycle row is ever deleted by the app.
REVOKE DELETE ON osirus_intel.rsi_cycles FROM osirus_app;

ALTER TABLE osirus_intel.learning_artifacts DROP CONSTRAINT IF EXISTS learning_artifacts_kind_check;
ALTER TABLE osirus_intel.learning_artifacts ADD CONSTRAINT learning_artifacts_kind_check CHECK (kind = ANY (ARRAY['strategic_memory'::text, 'procedural_memory'::text, 'causal_memory'::text, 'skill_candidate'::text, 'strategy_candidate'::text, 'eval_case'::text, 'curriculum_task'::text, 'training_example'::text, 'failure_pattern'::text, 'router_stat'::text, 'procedure'::text, 'tool_candidate'::text, 'meta_policy'::text, 'ablation_result'::text, 'failure_memory'::text, 'anti_pattern'::text, 'benchmark_result'::text, 'code_hypothesis'::text, 'live_order'::text, 'rollup'::text]));

ALTER TABLE osirus_intel.resource_ledger DROP CONSTRAINT IF EXISTS resource_ledger_category_check;
ALTER TABLE osirus_intel.resource_ledger ADD CONSTRAINT resource_ledger_category_check CHECK (category = ANY (ARRAY['model_calls'::text, 'tokens'::text, 'cost_usd'::text, 'sandbox_minutes'::text, 'chained_ticks'::text, 'trials'::text, 'rsi_model_calls'::text]));
