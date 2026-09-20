-- Reconstructed from osirus-m1-m5-verify. Source of truth; reviewed extraction.
CREATE SCHEMA IF NOT EXISTS osirus;

CREATE TABLE osirus.checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_id uuid,
  label text NOT NULL,
  state jsonb NOT NULL,
  version integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
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

ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_label_check CHECK (char_length(label) >= 1 AND char_length(label) <= 160);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (id);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_run_id_version_key UNIQUE (run_id, version);
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.checkpoints ADD CONSTRAINT checkpoints_version_check CHECK (version > 0);
ALTER TABLE osirus.messages ADD CONSTRAINT messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE osirus.messages ADD CONSTRAINT messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));
ALTER TABLE osirus.messages ADD CONSTRAINT messages_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE CASCADE;
ALTER TABLE osirus.messages ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (organization_id, user_id);
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_role_check CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]));
ALTER TABLE osirus.organization_memberships ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);
ALTER TABLE osirus.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_attempt_number_check CHECK (attempt_number > 0);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_stage_id_attempt_number_key UNIQUE NULLS NOT DISTINCT (stage_id, attempt_number);
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_attempts ADD CONSTRAINT run_attempts_status_check CHECK (status = ANY (ARRAY['created'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_run_id_sequence_key UNIQUE (run_id, sequence);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_sequence_check CHECK (sequence > 0);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_summary_check CHECK (char_length(summary) >= 1 AND char_length(summary) <= 1000);
ALTER TABLE osirus.run_events ADD CONSTRAINT run_events_visibility_check CHECK (visibility = ANY (ARRAY['user'::text, 'internal'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_capability_check CHECK (capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_ordinal_check CHECK (ordinal >= 0);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_parent_stage_id_fkey FOREIGN KEY (parent_stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL;
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_pkey PRIMARY KEY (id);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE;
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_run_id_ordinal_key UNIQUE (run_id, ordinal);
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'blocked'::text]));
ALTER TABLE osirus.run_stages ADD CONSTRAINT run_stages_verifier_status_check CHECK (verifier_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'conflicted'::text, 'rejected'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_complexity_check CHECK (complexity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_objective_check CHECK (char_length(objective) >= 1 AND char_length(objective) <= 100000);
ALTER TABLE osirus.runs ADD CONSTRAINT runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_pkey PRIMARY KEY (id);
ALTER TABLE osirus.runs ADD CONSTRAINT runs_primary_capability_check CHECK (primary_capability = ANY (ARRAY['coding'::text, 'research'::text, 'math_science'::text, 'data'::text, 'general'::text, 'multimodal'::text, 'computer_use'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE CASCADE;
ALTER TABLE osirus.runs ADD CONSTRAINT runs_status_check CHECK (status = ANY (ARRAY['created'::text, 'queued'::text, 'running'::text, 'waiting_for_approval'::text, 'verifying'::text, 'repairing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
ALTER TABLE osirus.runs ADD CONSTRAINT runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 240);
ALTER TABLE osirus.sessions ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES neon_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE osirus.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, user_id);
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_role_check CHECK (role = ANY (ARRAY['owner'::text, 'editor'::text, 'viewer'::text]));
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspace_memberships ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id) ON DELETE RESTRICT;
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 160);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE;
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_organization_id_slug_key UNIQUE (organization_id, slug);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
ALTER TABLE osirus.workspaces ADD CONSTRAINT workspaces_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text);

CREATE INDEX checkpoints_run_version_idx ON osirus.checkpoints USING btree (run_id, version DESC);
CREATE INDEX messages_session_created_idx ON osirus.messages USING btree (session_id, created_at);
CREATE INDEX organization_memberships_user_idx ON osirus.organization_memberships USING btree (user_id, organization_id);
CREATE INDEX run_events_run_sequence_idx ON osirus.run_events USING btree (run_id, sequence);
CREATE INDEX run_stages_run_ordinal_idx ON osirus.run_stages USING btree (run_id, ordinal);
CREATE INDEX runs_active_idx ON osirus.runs USING btree (workspace_id, status, updated_at DESC) WHERE (status = ANY (ARRAY['created'::text, 'queued'::text, 'running'::text, 'waiting_for_approval'::text, 'verifying'::text, 'repairing'::text]));
CREATE INDEX runs_session_created_idx ON osirus.runs USING btree (session_id, created_at DESC);
CREATE INDEX runs_workspace_created_idx ON osirus.runs USING btree (workspace_id, created_at DESC);
CREATE INDEX sessions_workspace_updated_idx ON osirus.sessions USING btree (workspace_id, updated_at DESC) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX users_email_unique ON osirus.users USING btree (lower(email)) WHERE (email IS NOT NULL);
CREATE INDEX workspace_memberships_user_idx ON osirus.workspace_memberships USING btree (user_id, workspace_id);
CREATE INDEX workspaces_organization_idx ON osirus.workspaces USING btree (organization_id, created_at DESC);
