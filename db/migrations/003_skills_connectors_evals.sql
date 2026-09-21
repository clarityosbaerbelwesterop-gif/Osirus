-- Reconstructed from osirus-m1-m5-verify.
CREATE TABLE osirus.connector_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connector_installation_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  workspace_id uuid,
  granted_by uuid NOT NULL,
  grantee_type text NOT NULL,
  grantee_id text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.connector_installations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid,
  connector_id text NOT NULL,
  status text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_reference text,
  installed_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.eval_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  eval_run_id uuid NOT NULL,
  metric text NOT NULL,
  value numeric,
  passed boolean,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.eval_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  workspace_id uuid,
  initiated_by uuid,
  benchmark_category text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE osirus.skill_definitions (
  id text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  activation_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text NOT NULL,
  risk text NOT NULL,
  tool_needs jsonb NOT NULL DEFAULT '[]'::jsonb,
  capability_affinity jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_context_cost integer NOT NULL,
  source jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.skill_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  stage_id uuid,
  skill_id text NOT NULL,
  skill_version text NOT NULL,
  selection_score numeric(8,5),
  outcome text,
  verifier_status text,
  repair_rounds integer NOT NULL DEFAULT 0,
  latency_ms integer,
  token_cost integer,
  tool_call_count integer NOT NULL DEFAULT 0,
  user_rework_signal boolean,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.skill_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_id text NOT NULL,
  version text NOT NULL,
  instruction text NOT NULL,
  source jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_pkey PRIMARY KEY (id);
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.eval_results ADD CONSTRAINT eval_results_pkey PRIMARY KEY (id);
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_organization_id_workspace_id_connec_key UNIQUE NULLS NOT DISTINCT (organization_id, workspace_id, connector_id);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_slug_key UNIQUE (slug);
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_skill_id_version_key UNIQUE (skill_id, version);
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_grantee_type_check CHECK (grantee_type = ANY (ARRAY['workspace'::text, 'run'::text, 'user'::text]));
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_status_check CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text, 'error'::text]));
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_status_check CHECK (status = ANY (ARRAY['created'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_estimated_context_cost_check CHECK (estimated_context_cost > 0);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_priority_check CHECK (priority = ANY (ARRAY['P0'::text, 'P1'::text]));
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_outcome_check CHECK (outcome = ANY (ARRAY['pending'::text, 'success'::text, 'failure'::text, 'inconclusive'::text]));
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_repair_rounds_check CHECK (repair_rounds >= 0);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_tool_call_count_check CHECK (tool_call_count >= 0);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_verifier_status_check CHECK (verifier_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_connector_installation_id_fkey FOREIGN KEY (connector_installation_id) REFERENCES osirus.connector_installations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_connector_installation_id_fkey FOREIGN KEY (connector_installation_id) REFERENCES osirus.connector_installations(id) ON DELETE SET NULL;
ALTER TABLE osirus.eval_results ADD CONSTRAINT eval_results_eval_run_id_fkey FOREIGN KEY (eval_run_id) REFERENCES osirus.eval_runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES osirus.users(id) ON DELETE SET NULL;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES osirus.skill_definitions(id) ON DELETE RESTRICT;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES osirus.skill_definitions(id) ON DELETE CASCADE;

CREATE INDEX skill_usage_run_idx ON osirus.skill_usage USING btree (run_id, stage_id, created_at);
