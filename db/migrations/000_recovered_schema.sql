-- Canonical M1-M5 schema recovered from osirus-m1-m5-verify.
CREATE SCHEMA IF NOT EXISTS osirus;

CREATE TABLE osirus.approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  stage_id uuid,
  action text NOT NULL,
  risk text NOT NULL,
  status text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by uuid,
  decided_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid,
  run_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  content_type text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_key text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.capability_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  capability text NOT NULL,
  ordinal integer NOT NULL,
  pipeline_name text NOT NULL,
  classification jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_id uuid,
  label text NOT NULL,
  state jsonb NOT NULL,
  version integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

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

CREATE TABLE osirus.memory_embeddings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  memory_item_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  embedding jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.memory_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_id uuid,
  workspace_id uuid,
  canonical_name text NOT NULL,
  entity_type text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.memory_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_id uuid,
  workspace_id uuid,
  session_id uuid,
  run_id uuid,
  scope text NOT NULL,
  layer text NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  searchable_text text NOT NULL,
  subject_key text,
  canonical_value text,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL,
  importance numeric(4,3) NOT NULL,
  verification_status text NOT NULL,
  contradiction_status text NOT NULL DEFAULT 'none'::text,
  supersedes_memory_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_accessed_at timestamp with time zone
);

CREATE TABLE osirus.memory_relations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_id uuid,
  workspace_id uuid,
  from_entity_id uuid NOT NULL,
  to_entity_id uuid NOT NULL,
  relation_type text NOT NULL,
  source_memory_id uuid,
  confidence numeric(4,3) NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.memory_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_id uuid,
  workspace_id uuid,
  session_id uuid,
  run_id uuid,
  layer text NOT NULL,
  horizon text NOT NULL,
  summary text NOT NULL,
  source_memory_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  run_id uuid,
  role text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.model_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid,
  stage_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  logical_role text NOT NULL,
  status text NOT NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(14,8),
  latency_ms integer,
  error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE osirus.organization_memberships (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.run_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_id uuid,
  attempt_number integer NOT NULL,
  worker_kind text NOT NULL,
  status text NOT NULL,
  handoff jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.run_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_id uuid,
  sequence bigint NOT NULL,
  type text NOT NULL,
  visibility text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.run_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  parent_stage_id uuid,
  ordinal integer NOT NULL,
  name text NOT NULL,
  capability text NOT NULL,
  status text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  verifier_status text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  objective text NOT NULL,
  primary_capability text NOT NULL,
  secondary_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  complexity text NOT NULL,
  status text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error_code text,
  error_message text,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  created_by uuid NOT NULL,
  archived_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
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

CREATE TABLE osirus.tool_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid,
  stage_id uuid,
  connector_installation_id uuid,
  tool_name text NOT NULL,
  operation text NOT NULL,
  risk text NOT NULL,
  status text NOT NULL,
  input_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer,
  error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE osirus.usage_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid,
  run_id uuid,
  source_type text NOT NULL,
  source_id text NOT NULL,
  metric text NOT NULL,
  quantity numeric(18,6) NOT NULL,
  unit text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.users (
  id uuid NOT NULL,
  email text,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.workspace_memberships (
  workspace_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE osirus.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (id);
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_pkey PRIMARY KEY (id);
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.eval_results ADD CONSTRAINT eval_results_pkey PRIMARY KEY (id);
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_pkey PRIMARY KEY (id);
ALTER TABLE osirus.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_pkey PRIMARY KEY (id);
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (organization_id, user_id);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_pkey PRIMARY KEY (id);
ALTER TABLE osirus.runs ADD CONSTRAINT runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_pkey PRIMARY KEY (id);
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_pkey PRIMARY KEY (id);
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);
ALTER TABLE osirus.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, user_id);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_run_id_ordinal_key UNIQUE (run_id, ordinal);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_run_id_version_key UNIQUE (run_id, version);
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_organization_id_workspace_id_connec_key UNIQUE NULLS NOT DISTINCT (organization_id, workspace_id, connector_id);
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_memory_item_id_provider_model_key UNIQUE (memory_item_id, provider, model);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_owner_id_workspace_id_canonical_name_entity_key UNIQUE NULLS NOT DISTINCT (owner_id, workspace_id, canonical_name, entity_type);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_stage_id_attempt_number_key UNIQUE NULLS NOT DISTINCT (stage_id, attempt_number);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_run_id_sequence_key UNIQUE (run_id, sequence);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_run_id_ordinal_key UNIQUE (run_id, ordinal);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_slug_key UNIQUE (slug);
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_skill_id_version_key UNIQUE (skill_id, version);
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_source_type_source_id_metric_key UNIQUE (source_type, source_id, metric);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_organization_id_slug_key UNIQUE (organization_id, slug);
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_status_check CHECK (status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 240);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_capability_check CHECK (capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_ordinal_check CHECK (ordinal >= 0);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_label_check CHECK (char_length(label) >= 1 AND char_length(label) <= 160);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_version_check CHECK (version > 0);
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_grantee_type_check CHECK (grantee_type = ANY (ARRAY['workspace'::text, 'run'::text, 'user'::text]));
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_status_check CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text, 'error'::text]));
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_status_check CHECK (status = ANY (ARRAY['created'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_dimensions_check CHECK (dimensions > 0);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_contradiction_status_check CHECK (contradiction_status = ANY (ARRAY['none'::text, 'suspected'::text, 'resolved'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_importance_check CHECK (importance >= 0::numeric AND importance <= 1::numeric);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_kind_check CHECK (kind = ANY (ARRAY['decision'::text, 'fact'::text, 'evidence'::text, 'project_map'::text, 'run_summary'::text, 'artifact'::text, 'constraint'::text, 'pattern'::text, 'blocker'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_layer_check CHECK (layer = ANY (ARRAY['second'::text, 'third'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_scope_check CHECK (scope = ANY (ARRAY['session'::text, 'workspace'::text, 'organization'::text, 'user'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_verification_status_check CHECK (verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_check CHECK (from_entity_id <> to_entity_id);
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_horizon_check CHECK (horizon = ANY (ARRAY['stage'::text, 'run'::text, 'session'::text, 'workspace'::text, 'historical'::text]));
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_layer_check CHECK (layer = ANY (ARRAY['second'::text, 'third'::text]));
ALTER TABLE osirus.messages ADD CONSTRAINT messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_status_check CHECK (status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_role_check CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]));
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_attempt_number_check CHECK (attempt_number > 0);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_status_check CHECK (status = ANY (ARRAY['created'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_sequence_check CHECK (sequence > 0);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_summary_check CHECK (char_length(summary) >= 1 AND char_length(summary) <= 1000);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_visibility_check CHECK (visibility = ANY (ARRAY['user'::text, 'internal'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_capability_check CHECK (capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_ordinal_check CHECK (ordinal >= 0);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'blocked'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_verifier_status_check CHECK (verifier_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_complexity_check CHECK (complexity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_objective_check CHECK (char_length(objective) >= 1 AND char_length(objective) <= 100000);
ALTER TABLE osirus.runs ADD CONSTRAINT runs_primary_capability_check CHECK (primary_capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_status_check CHECK (status = ANY (ARRAY['created'::text, 'queued'::text, 'running'::text, 'waiting_for_approval'::text, 'verifying'::text, 'repairing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 240);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_estimated_context_cost_check CHECK (estimated_context_cost > 0);
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_priority_check CHECK (priority = ANY (ARRAY['P0'::text, 'P1'::text]));
ALTER TABLE osirus.skill_definitions ADD CONSTRAINT skill_definitions_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_outcome_check CHECK (outcome = ANY (ARRAY['pending'::text, 'success'::text, 'failure'::text, 'inconclusive'::text]));
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_repair_rounds_check CHECK (repair_rounds >= 0);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_tool_call_count_check CHECK (tool_call_count >= 0);
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_verifier_status_check CHECK (verifier_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_status_check CHECK (status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'awaiting_approval'::text]));
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_role_check CHECK (role = ANY (ARRAY['owner'::text, 'editor'::text, 'viewer'::text]));
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES osirus.users(id) ON DELETE SET NULL;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_connector_installation_id_fkey FOREIGN KEY (connector_installation_id) REFERENCES osirus.connector_installations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_grants ADD CONSTRAINT connector_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.connector_installations ADD CONSTRAINT connector_installations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.eval_results ADD CONSTRAINT eval_results_eval_run_id_fkey FOREIGN KEY (eval_run_id) REFERENCES osirus.eval_runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES osirus.users(id) ON DELETE SET NULL;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.eval_runs ADD CONSTRAINT eval_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_memory_item_id_fkey FOREIGN KEY (memory_item_id) REFERENCES osirus.memory_items(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_supersedes_memory_id_fkey FOREIGN KEY (supersedes_memory_id) REFERENCES osirus.memory_items(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_from_entity_id_fkey FOREIGN KEY (from_entity_id) REFERENCES osirus.memory_entities(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_source_memory_id_fkey FOREIGN KEY (source_memory_id) REFERENCES osirus.memory_items(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_to_entity_id_fkey FOREIGN KEY (to_entity_id) REFERENCES osirus.memory_entities(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE CASCADE;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_parent_stage_id_fkey FOREIGN KEY (parent_stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE CASCADE;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES osirus.skill_definitions(id) ON DELETE RESTRICT;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.skill_usage ADD CONSTRAINT skill_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.skill_versions ADD CONSTRAINT skill_versions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES osirus.skill_definitions(id) ON DELETE CASCADE;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_connector_installation_id_fkey FOREIGN KEY (connector_installation_id) REFERENCES osirus.connector_installations(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE SET NULL;
ALTER TABLE osirus.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES neon_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;

CREATE INDEX approvals_run_status_idx ON osirus.approvals USING btree (run_id, status, created_at DESC);
CREATE INDEX artifacts_run_created_idx ON osirus.artifacts USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX artifacts_workspace_created_idx ON osirus.artifacts USING btree (workspace_id, created_at DESC);
CREATE INDEX checkpoints_run_version_idx ON osirus.checkpoints USING btree (run_id, version DESC);
CREATE INDEX memory_entities_scope_idx ON osirus.memory_entities USING btree (owner_id, workspace_id, canonical_name);
CREATE INDEX memory_items_scope_idx ON osirus.memory_items USING btree (owner_id, workspace_id, importance DESC, updated_at DESC);
CREATE INDEX memory_items_search_idx ON osirus.memory_items USING gin (to_tsvector('simple'::regconfig, searchable_text));
CREATE INDEX memory_items_subject_idx ON osirus.memory_items USING btree (owner_id, subject_key) WHERE (subject_key IS NOT NULL);
CREATE INDEX memory_relations_from_idx ON osirus.memory_relations USING btree (from_entity_id, relation_type);
CREATE INDEX memory_relations_to_idx ON osirus.memory_relations USING btree (to_entity_id, relation_type);
CREATE INDEX memory_summaries_scope_idx ON osirus.memory_summaries USING btree (owner_id, workspace_id, horizon, updated_at DESC);
CREATE INDEX messages_session_created_idx ON osirus.messages USING btree (session_id, created_at);
CREATE INDEX model_calls_run_created_idx ON osirus.model_calls USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX organization_memberships_user_idx ON osirus.organization_memberships USING btree (user_id, organization_id);
CREATE INDEX run_events_run_sequence_idx ON osirus.run_events USING btree (run_id, sequence);
CREATE INDEX run_stages_run_ordinal_idx ON osirus.run_stages USING btree (run_id, ordinal);
CREATE INDEX runs_active_idx ON osirus.runs USING btree (workspace_id, status, updated_at DESC) WHERE (status = ANY (ARRAY['created'::text, 'queued'::text, 'running'::text, 'waiting_for_approval'::text, 'verifying'::text, 'repairing'::text]));
CREATE INDEX runs_session_created_idx ON osirus.runs USING btree (session_id, created_at DESC);
CREATE INDEX runs_workspace_created_idx ON osirus.runs USING btree (workspace_id, created_at DESC);
CREATE INDEX sessions_workspace_updated_idx ON osirus.sessions USING btree (workspace_id, updated_at DESC) WHERE (archived_at IS NULL);
CREATE INDEX skill_usage_run_idx ON osirus.skill_usage USING btree (run_id, stage_id, created_at);
CREATE INDEX tool_calls_run_created_idx ON osirus.tool_calls USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX usage_ledger_organization_idx ON osirus.usage_ledger USING btree (organization_id, occurred_at DESC);
CREATE UNIQUE INDEX users_email_unique ON osirus.users USING btree (lower(email)) WHERE (email IS NOT NULL);
CREATE INDEX workspace_memberships_user_idx ON osirus.workspace_memberships USING btree (user_id, workspace_id);
CREATE INDEX workspaces_organization_idx ON osirus.workspaces USING btree (organization_id, created_at DESC);
