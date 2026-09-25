-- Durable capability pulse.
--
-- Additive. The M34 pulse kept its cycle, cursor and baselines in module
-- variables, so a cold instance started over and the product process never
-- saw a baseline. The pulse now keeps them here, under the same rules as the
-- rest of the Intelligence Plane: only the system writes, operators read.
--
-- A cycle is claimed with a lease, so two ticks cannot drive one cycle at
-- once. A result is keyed by (cycle, task), so a replayed tick writes nothing
-- twice. Baselines are versioned by the suite version: a changed task set
-- starts new cells instead of mixing incomparable numbers. This is not a
-- second scheduler; the existing tick drives it.

CREATE TABLE IF NOT EXISTS osirus_intel.pulse_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  suite_version text NOT NULL,
  task_ids text[] NOT NULL DEFAULT '{}'::text[],
  cursor integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  lease_owner text,
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  next_due_at timestamp with time zone,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT pulse_cycles_status_check CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'abandoned'::text])),
  CONSTRAINT pulse_cycles_cursor_check CHECK (cursor >= 0 AND cursor <= cardinality(task_ids))
);

CREATE UNIQUE INDEX IF NOT EXISTS pulse_cycles_one_running_idx
  ON osirus_intel.pulse_cycles ((status)) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS pulse_cycles_started_idx
  ON osirus_intel.pulse_cycles (started_at DESC);

CREATE TABLE IF NOT EXISTS osirus_intel.pulse_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL,
  task_id text NOT NULL,
  suite_version text NOT NULL,
  family text NOT NULL,
  level smallint NOT NULL,
  difficulty text NOT NULL,
  mode text NOT NULL,
  outcome text NOT NULL,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_calls integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pulse_results_task_key UNIQUE (cycle_id, task_id),
  CONSTRAINT pulse_results_level_check CHECK (level BETWEEN 1 AND 5),
  CONSTRAINT pulse_results_mode_check CHECK (mode = ANY (ARRAY['offline'::text, 'live'::text])),
  CONSTRAINT pulse_results_outcome_check CHECK (outcome = ANY (ARRAY['VERIFIED_SUCCESS'::text, 'SUCCESS_UNVERIFIED'::text, 'PARTIAL'::text, 'REJECTED'::text, 'FALSE_COMPLETION'::text, 'INCONCLUSIVE'::text, 'INFRASTRUCTURE_FAILURE'::text])),
  CONSTRAINT pulse_results_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES osirus_intel.pulse_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pulse_results_cell_idx
  ON osirus_intel.pulse_results (suite_version, family, level, created_at DESC);

CREATE TABLE IF NOT EXISTS osirus_intel.pulse_baselines (
  suite_version text NOT NULL,
  family text NOT NULL,
  level smallint NOT NULL,
  samples integer NOT NULL DEFAULT 0,
  verified integer NOT NULL DEFAULT 0,
  false_completions integer NOT NULL DEFAULT 0,
  excluded integer NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  lower numeric NOT NULL DEFAULT 0,
  upper numeric NOT NULL DEFAULT 1,
  regression_streak integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (suite_version, family, level),
  CONSTRAINT pulse_baselines_level_check CHECK (level BETWEEN 1 AND 5),
  CONSTRAINT pulse_baselines_counts_check CHECK (samples >= 0 AND verified >= 0 AND verified <= samples AND false_completions >= 0 AND excluded >= 0 AND regression_streak >= 0)
);

ALTER TABLE osirus_intel.pulse_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.pulse_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY pulse_cycles_read ON osirus_intel.pulse_cycles
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY pulse_cycles_write ON osirus_intel.pulse_cycles
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.pulse_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.pulse_results FORCE ROW LEVEL SECURITY;
CREATE POLICY pulse_results_read ON osirus_intel.pulse_results
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY pulse_results_write ON osirus_intel.pulse_results
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus_intel.pulse_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus_intel.pulse_baselines FORCE ROW LEVEL SECURITY;
CREATE POLICY pulse_baselines_read ON osirus_intel.pulse_baselines
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus_intel.is_operator());
CREATE POLICY pulse_baselines_write ON osirus_intel.pulse_baselines
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE ON osirus_intel.pulse_cycles TO osirus_app;
GRANT SELECT, INSERT ON osirus_intel.pulse_results TO osirus_app;
GRANT SELECT, INSERT, UPDATE ON osirus_intel.pulse_baselines TO osirus_app;

-- The database's default privileges give the app role every table verb.
-- Take back what the pulse must not do: results are append-only, and no
-- pulse row is ever deleted by the app.
REVOKE UPDATE, DELETE ON osirus_intel.pulse_results FROM osirus_app;
REVOKE DELETE ON osirus_intel.pulse_cycles FROM osirus_app;
REVOKE DELETE ON osirus_intel.pulse_baselines FROM osirus_app;
