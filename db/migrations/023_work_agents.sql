-- Work recommendations and user-defined agents.
-- Additive. Does not change osirus.model_calls.
-- No public URL, widget, or deploy flag: an agent is a workspace record.

ALTER TABLE osirus.sessions DROP CONSTRAINT IF EXISTS sessions_surface_check;
ALTER TABLE osirus.sessions
  ADD CONSTRAINT sessions_surface_check
  CHECK (surface = ANY (ARRAY['ai'::text, 'agent'::text, 'bot'::text, 'coding'::text, 'work'::text]));

ALTER TABLE osirus.runs
  ADD COLUMN IF NOT EXISTS difficulty_class text,
  ADD COLUMN IF NOT EXISTS exec_model text,
  ADD COLUMN IF NOT EXISTS reviewer_model text,
  ADD COLUMN IF NOT EXISTS subagent_count integer,
  ADD COLUMN IF NOT EXISTS recommendation jsonb,
  ADD COLUMN IF NOT EXISTS user_overrides jsonb;

ALTER TABLE osirus.runs DROP CONSTRAINT IF EXISTS runs_difficulty_class_check;
ALTER TABLE osirus.runs
  ADD CONSTRAINT runs_difficulty_class_check
  CHECK (
    difficulty_class IS NULL
    OR difficulty_class = ANY (ARRAY['S'::text, 'M'::text, 'L'::text, 'XL'::text])
  );

ALTER TABLE osirus.runs DROP CONSTRAINT IF EXISTS runs_reviewer_distinct_check;
ALTER TABLE osirus.runs
  ADD CONSTRAINT runs_reviewer_distinct_check
  CHECK (
    exec_model IS NULL
    OR reviewer_model IS NULL
    OR exec_model <> reviewer_model
  );

ALTER TABLE osirus.runs DROP CONSTRAINT IF EXISTS runs_subagent_count_check;
ALTER TABLE osirus.runs
  ADD CONSTRAINT runs_subagent_count_check
  CHECK (
    subagent_count IS NULL
    OR (subagent_count >= 0 AND subagent_count <= 50)
  );

CREATE TABLE IF NOT EXISTS osirus.subagent_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  ordinal integer NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(14, 8),
  error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT subagent_runs_ordinal_check CHECK (ordinal >= 0),
  CONSTRAINT subagent_runs_status_check CHECK (
    status = ANY (ARRAY['waiting'::text, 'running'::text, 'completed'::text, 'failed'::text, 'unavailable'::text])
  ),
  CONSTRAINT subagent_runs_run_ordinal_key UNIQUE (run_id, ordinal),
  CONSTRAINT subagent_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs (id) ON DELETE CASCADE,
  CONSTRAINT subagent_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS osirus.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  reviewer_model text NOT NULL,
  verdict text NOT NULL,
  findings text,
  estimated_cost_usd numeric(14, 8),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT reviews_run_id_key UNIQUE (run_id),
  CONSTRAINT reviews_verdict_check CHECK (
    verdict = ANY (ARRAY['passed'::text, 'revise'::text, 'rejected'::text, 'unverified'::text, 'unavailable'::text])
  ),
  CONSTRAINT reviews_distinct_model_check CHECK (reviewer_model <> ''),
  CONSTRAINT reviews_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs (id) ON DELETE CASCADE,
  CONSTRAINT reviews_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS osirus.agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  system_prompt text NOT NULL DEFAULT '',
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agents_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT agents_prompt_check CHECK (char_length(system_prompt) <= 8000),
  CONSTRAINT agents_model_check CHECK (
    char_length(model_id) BETWEEN 1 AND 200
    AND model_id !~* '^(rouge|quasnir|darus)$'
    AND model_id !~ '^PLACEHOLDER_'
  ),
  CONSTRAINT agents_status_check CHECK (status = ANY (ARRAY['active'::text, 'paused'::text])),
  CONSTRAINT agents_workspace_name_key UNIQUE (workspace_id, name),
  CONSTRAINT agents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations (id) ON DELETE CASCADE,
  CONSTRAINT agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE,
  CONSTRAINT agents_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users (id)
);

CREATE TABLE IF NOT EXISTS osirus.group_chats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT group_chats_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT group_chats_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations (id) ON DELETE CASCADE,
  CONSTRAINT group_chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE,
  CONSTRAINT group_chats_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users (id)
);

CREATE TABLE IF NOT EXISTS osirus.group_chat_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  group_chat_id uuid NOT NULL,
  agent_id uuid,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT group_chat_members_one_subject_check CHECK (
    (agent_id IS NOT NULL AND user_id IS NULL)
    OR (agent_id IS NULL AND user_id IS NOT NULL)
  ),
  CONSTRAINT group_chat_members_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES osirus.group_chats (id) ON DELETE CASCADE,
  CONSTRAINT group_chat_members_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES osirus.agents (id) ON DELETE CASCADE,
  CONSTRAINT group_chat_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users (id) ON DELETE CASCADE,
  CONSTRAINT group_chat_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS group_chat_members_agent_key
  ON osirus.group_chat_members (group_chat_id, agent_id)
  WHERE agent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS group_chat_members_user_key
  ON osirus.group_chat_members (group_chat_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS osirus.group_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  group_chat_id uuid NOT NULL,
  author_role text NOT NULL,
  author_user_id uuid,
  agent_id uuid,
  content text NOT NULL,
  status text NOT NULL,
  model_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT group_chat_messages_role_check CHECK (author_role = ANY (ARRAY['user'::text, 'agent'::text])),
  CONSTRAINT group_chat_messages_status_check CHECK (
    status = ANY (ARRAY['stored'::text, 'completed'::text, 'unavailable'::text, 'failed'::text])
  ),
  CONSTRAINT group_chat_messages_content_check CHECK (char_length(content) BETWEEN 1 AND 8000),
  CONSTRAINT group_chat_messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES osirus.group_chats (id) ON DELETE CASCADE,
  CONSTRAINT group_chat_messages_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES osirus.agents (id) ON DELETE SET NULL,
  CONSTRAINT group_chat_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE
);

ALTER TABLE osirus.subagent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.subagent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY subagent_runs_read ON osirus.subagent_runs
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY subagent_runs_write ON osirus.subagent_runs
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON osirus.reviews
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY reviews_write ON osirus.reviews
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.agents FORCE ROW LEVEL SECURITY;
CREATE POLICY agents_read ON osirus.agents
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY agents_insert ON osirus.agents
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    osirus.can_manage_workspace(workspace_id)
    AND created_by = osirus.current_user_id()
  );
CREATE POLICY agents_update ON osirus.agents
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY agents_delete ON osirus.agents
  AS PERMISSIVE FOR DELETE TO public
  USING (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.group_chats FORCE ROW LEVEL SECURITY;
CREATE POLICY group_chats_read ON osirus.group_chats
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY group_chats_insert ON osirus.group_chats
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    osirus.can_manage_workspace(workspace_id)
    AND created_by = osirus.current_user_id()
  );
CREATE POLICY group_chats_update ON osirus.group_chats
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY group_chats_delete ON osirus.group_chats
  AS PERMISSIVE FOR DELETE TO public
  USING (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.group_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.group_chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY group_chat_members_access ON osirus.group_chat_members
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.group_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.group_chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY group_chat_messages_read ON osirus.group_chat_messages
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY group_chat_messages_insert ON osirus.group_chat_messages
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.subagent_runs TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.reviews TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.agents TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.group_chats TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.group_chat_members TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.group_chat_messages TO osirus_app;
