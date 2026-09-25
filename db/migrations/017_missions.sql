-- The mission state of a run.
--
-- Additive. A run's stages each keep working state in the run checkpoint
-- while they run; the checkpoint is one document per run and its last writer
-- wins, so it cannot hold state that parallel stages of different
-- capabilities must share. The mission row is that shared state: the
-- contract, capability nodes, facts with provenance, hypotheses, open
-- questions, plan revisions, capability switches and (M40) waits, goals and
-- the completed-action ledger. Writers compare and swap on `version`, so two
-- stages reconciling at once cannot overwrite each other.
--
-- Tenant data under the run's own access rules. Not a second checkpoint
-- store and not a scheduler.

CREATE TABLE IF NOT EXISTS osirus.run_missions (
  run_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id),
  CONSTRAINT run_missions_version_check CHECK (version >= 1),
  CONSTRAINT run_missions_state_check CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT run_missions_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE
);

ALTER TABLE osirus.run_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_missions FORCE ROW LEVEL SECURITY;
CREATE POLICY run_missions_read ON osirus.run_missions
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus.can_access_run(run_id));
CREATE POLICY run_missions_write ON osirus.run_missions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.is_system() OR osirus.can_manage_run(run_id));
CREATE POLICY run_missions_update ON osirus.run_missions
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.is_system() OR osirus.can_manage_run(run_id))
  WITH CHECK (osirus.is_system() OR osirus.can_manage_run(run_id));

GRANT SELECT, INSERT, UPDATE ON osirus.run_missions TO osirus_app;
-- Default privileges would also grant DELETE; a mission goes only when its
-- run goes (ON DELETE CASCADE), never on its own.
REVOKE DELETE ON osirus.run_missions FROM osirus_app;
