-- Reconstructed from osirus-m1-m5-verify. JSONB embeddings are intentionally not vector search.
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

ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES osirus.users(id) ON DELETE SET NULL;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_status_check CHECK (status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE osirus.approvals ADD CONSTRAINT approvals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 240);
ALTER TABLE osirus.artifacts ADD CONSTRAINT artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_capability_check CHECK (capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_ordinal_check CHECK (ordinal >= 0);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_run_id_ordinal_key UNIQUE (run_id, ordinal);
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.capability_runs ADD CONSTRAINT capability_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_dimensions_check CHECK (dimensions > 0);
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_memory_item_id_fkey FOREIGN KEY (memory_item_id) REFERENCES osirus.memory_items(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_memory_item_id_provider_model_key UNIQUE (memory_item_id, provider, model);
ALTER TABLE osirus.memory_embeddings ADD CONSTRAINT memory_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_owner_id_workspace_id_canonical_name_entity_key UNIQUE NULLS NOT DISTINCT (owner_id, workspace_id, canonical_name, entity_type);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_entities ADD CONSTRAINT memory_entities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_contradiction_status_check CHECK (contradiction_status = ANY (ARRAY['none'::text, 'suspected'::text, 'resolved'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_importance_check CHECK (importance >= 0::numeric AND importance <= 1::numeric);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_kind_check CHECK (kind = ANY (ARRAY['decision'::text, 'fact'::text, 'evidence'::text, 'project_map'::text, 'run_summary'::text, 'artifact'::text, 'constraint'::text, 'pattern'::text, 'blocker'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_layer_check CHECK (layer = ANY (ARRAY['second'::text, 'third'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_scope_check CHECK (scope = ANY (ARRAY['session'::text, 'workspace'::text, 'organization'::text, 'user'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_supersedes_memory_id_fkey FOREIGN KEY (supersedes_memory_id) REFERENCES osirus.memory_items(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_verification_status_check CHECK (verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.memory_items ADD CONSTRAINT memory_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_check CHECK (from_entity_id <> to_entity_id);
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_from_entity_id_fkey FOREIGN KEY (from_entity_id) REFERENCES osirus.memory_entities(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_source_memory_id_fkey FOREIGN KEY (source_memory_id) REFERENCES osirus.memory_items(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_to_entity_id_fkey FOREIGN KEY (to_entity_id) REFERENCES osirus.memory_entities(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_relations ADD CONSTRAINT memory_relations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_horizon_check CHECK (horizon = ANY (ARRAY['stage'::text, 'run'::text, 'session'::text, 'workspace'::text, 'historical'::text]));
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_layer_check CHECK (layer = ANY (ARRAY['second'::text, 'third'::text]));
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_pkey PRIMARY KEY (id);
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL;
ALTER TABLE osirus.memory_summaries ADD CONSTRAINT memory_summaries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_pkey PRIMARY KEY (id);
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_status_check CHECK (status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.model_calls ADD CONSTRAINT model_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_connector_installation_id_fkey FOREIGN KEY (connector_installation_id) REFERENCES osirus.connector_installations(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_pkey PRIMARY KEY (id);
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_risk_check CHECK (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_status_check CHECK (status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'awaiting_approval'::text]));
ALTER TABLE osirus.tool_calls ADD CONSTRAINT tool_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_source_type_source_id_metric_key UNIQUE (source_type, source_id, metric);
ALTER TABLE osirus.usage_ledger ADD CONSTRAINT usage_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE SET NULL;

CREATE INDEX approvals_run_status_idx ON osirus.approvals USING btree (run_id, status, created_at DESC);
CREATE INDEX artifacts_run_created_idx ON osirus.artifacts USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX artifacts_workspace_created_idx ON osirus.artifacts USING btree (workspace_id, created_at DESC);
CREATE INDEX memory_entities_scope_idx ON osirus.memory_entities USING btree (owner_id, workspace_id, canonical_name);
CREATE INDEX memory_items_scope_idx ON osirus.memory_items USING btree (owner_id, workspace_id, importance DESC, updated_at DESC);
CREATE INDEX memory_items_search_idx ON osirus.memory_items USING gin (to_tsvector('simple'::regconfig, searchable_text));
CREATE INDEX memory_items_subject_idx ON osirus.memory_items USING btree (owner_id, subject_key) WHERE (subject_key IS NOT NULL);
CREATE INDEX memory_relations_from_idx ON osirus.memory_relations USING btree (from_entity_id, relation_type);
CREATE INDEX memory_relations_to_idx ON osirus.memory_relations USING btree (to_entity_id, relation_type);
CREATE INDEX memory_summaries_scope_idx ON osirus.memory_summaries USING btree (owner_id, workspace_id, horizon, updated_at DESC);
CREATE INDEX model_calls_run_created_idx ON osirus.model_calls USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX tool_calls_run_created_idx ON osirus.tool_calls USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX usage_ledger_organization_idx ON osirus.usage_ledger USING btree (organization_id, occurred_at DESC);
