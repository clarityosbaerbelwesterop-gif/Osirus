-- Productization: connections, policies, security events, automations and
-- notifications, plus pinned conversations.
--
-- Additive only: new tables and nullable columns. Code from before this
-- migration keeps working against it, so it can be applied ahead of the
-- deployment that uses it. Every new table is tenant-scoped with row-level
-- security forced and policies built on the helpers from 004, and MCP tool
-- risk is fixed at 'high' by a CHECK constraint: an MCP server cannot declare
-- its own tools low-risk, and neither can a later code path.

ALTER TABLE osirus.sessions ADD COLUMN IF NOT EXISTS pinned_at timestamp with time zone;

-- MCP servers a workspace has added, and the tools discovered on them.

CREATE TABLE IF NOT EXISTS osirus.mcp_servers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  credential_reference text,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unchecked',
  server_name text,
  server_version text,
  last_checked_at timestamp with time zone,
  last_ok_at timestamp with time zone,
  last_latency_ms integer,
  last_error text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT mcp_servers_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT mcp_servers_url_check CHECK (url ~ '^https://' AND char_length(url) <= 500),
  CONSTRAINT mcp_servers_status_check CHECK (status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'degraded'::text, 'failed'::text])),
  CONSTRAINT mcp_servers_error_size_check CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT mcp_servers_workspace_name_key UNIQUE (workspace_id, name),
  CONSTRAINT mcp_servers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE,
  CONSTRAINT mcp_servers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT mcp_servers_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id)
);

CREATE TABLE IF NOT EXISTS osirus.mcp_server_tools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  server_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk text NOT NULL DEFAULT 'high',
  enabled boolean NOT NULL DEFAULT false,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  discovered_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT mcp_server_tools_risk_check CHECK (risk = 'high'),
  CONSTRAINT mcp_server_tools_name_check CHECK (char_length(name) BETWEEN 1 AND 128),
  CONSTRAINT mcp_server_tools_description_check CHECK (char_length(description) <= 2000),
  CONSTRAINT mcp_server_tools_enabled_reviewed_check CHECK (NOT enabled OR reviewed_at IS NOT NULL),
  CONSTRAINT mcp_server_tools_server_name_key UNIQUE (server_id, name),
  CONSTRAINT mcp_server_tools_server_id_fkey FOREIGN KEY (server_id) REFERENCES osirus.mcp_servers(id) ON DELETE CASCADE,
  CONSTRAINT mcp_server_tools_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT mcp_server_tools_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES osirus.users(id)
);

-- Live health checks of connections: every check is kept, the latest wins.

CREATE TABLE IF NOT EXISTS osirus.connector_health (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  connector_id text NOT NULL,
  ok boolean NOT NULL,
  latency_ms integer,
  error text,
  checked_by uuid,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT connector_health_connector_check CHECK (char_length(connector_id) BETWEEN 1 AND 120),
  CONSTRAINT connector_health_error_size_check CHECK (error IS NULL OR char_length(error) <= 500),
  CONSTRAINT connector_health_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS connector_health_latest_idx
  ON osirus.connector_health (workspace_id, connector_id, checked_at DESC);

-- What the agent may do on its own in a workspace.

CREATE TABLE IF NOT EXISTS osirus.workspace_policies (
  workspace_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  preset text NOT NULL DEFAULT 'balanced',
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id),
  CONSTRAINT workspace_policies_preset_check CHECK (preset = ANY (ARRAY['cautious'::text, 'balanced'::text, 'autonomous'::text, 'custom'::text])),
  CONSTRAINT workspace_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE
);

-- Security-relevant events, readable by the workspace, written by the actor
-- or by the system. Never updated.

CREATE TABLE IF NOT EXISTS osirus.security_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid,
  kind text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_events_kind_check CHECK (kind = ANY (ARRAY['prompt_injection_neutralized'::text, 'unsafe_path_blocked'::text, 'access_refused'::text, 'secret_redacted'::text, 'tool_denied'::text, 'approval_expired'::text, 'outbound_blocked'::text, 'policy_denied'::text])),
  CONSTRAINT security_events_severity_check CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])),
  CONSTRAINT security_events_summary_check CHECK (char_length(summary) <= 500),
  CONSTRAINT security_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT security_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS security_events_workspace_idx
  ON osirus.security_events (workspace_id, created_at DESC);

-- Durable automations: an objective that runs on a schedule or an event.

CREATE TABLE IF NOT EXISTS osirus.automations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL,
  objective text NOT NULL,
  trigger_kind text NOT NULL,
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_preset text NOT NULL DEFAULT 'cautious',
  max_cost_usd numeric(10,4),
  max_tokens integer,
  allowed_tools text[] NOT NULL DEFAULT '{}'::text[],
  notify_on text[] NOT NULL DEFAULT ARRAY['failed'::text, 'approval'::text],
  enabled boolean NOT NULL DEFAULT true,
  session_id uuid,
  next_run_at timestamp with time zone,
  last_run_at timestamp with time zone,
  last_run_id uuid,
  last_status text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT automations_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT automations_objective_check CHECK (char_length(objective) BETWEEN 1 AND 4000),
  CONSTRAINT automations_trigger_check CHECK (trigger_kind = ANY (ARRAY['schedule'::text, 'run_completed'::text, 'connector_changed'::text])),
  CONSTRAINT automations_policy_check CHECK (policy_preset = ANY (ARRAY['cautious'::text, 'balanced'::text])),
  CONSTRAINT automations_budget_check CHECK ((max_cost_usd IS NULL OR max_cost_usd > 0) AND (max_tokens IS NULL OR max_tokens > 0)),
  CONSTRAINT automations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT automations_created_by_fkey FOREIGN KEY (created_by) REFERENCES osirus.users(id),
  CONSTRAINT automations_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL,
  CONSTRAINT automations_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS automations_due_idx
  ON osirus.automations (next_run_at)
  WHERE enabled AND trigger_kind = 'schedule';

ALTER TABLE osirus.runs ADD COLUMN IF NOT EXISTS automation_id uuid;
ALTER TABLE osirus.runs ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'runs_automation_id_fkey'
  ) THEN
    ALTER TABLE osirus.runs
      ADD CONSTRAINT runs_automation_id_fkey FOREIGN KEY (automation_id)
      REFERENCES osirus.automations(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Notifications for one person. The dedupe key makes repeated triggers
-- (a re-checked approval, a retried run) produce one notification, not many.

CREATE TABLE IF NOT EXISTS osirus.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  run_id uuid,
  automation_id uuid,
  approval_id uuid,
  dedupe_key text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notifications_kind_check CHECK (kind = ANY (ARRAY['approval_needed'::text, 'automation_completed'::text, 'automation_failed'::text, 'run_blocked'::text, 'connector_expired'::text])),
  CONSTRAINT notifications_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT notifications_body_check CHECK (char_length(body) <= 1000),
  CONSTRAINT notifications_user_dedupe_key UNIQUE (user_id, dedupe_key),
  CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES osirus.users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE SET NULL,
  CONSTRAINT notifications_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES osirus.automations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON osirus.notifications (user_id, created_at DESC);

-- Row-level security.

ALTER TABLE osirus.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.mcp_servers FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_servers_access ON osirus.mcp_servers
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.mcp_server_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.mcp_server_tools FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_server_tools_access ON osirus.mcp_server_tools
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.connector_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.connector_health FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_health_read ON osirus.connector_health
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY connector_health_insert ON osirus.connector_health
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.can_access_workspace(workspace_id));

ALTER TABLE osirus.workspace_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.workspace_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_policies_read ON osirus.workspace_policies
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY workspace_policies_write ON osirus.workspace_policies
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.security_events FORCE ROW LEVEL SECURITY;
CREATE POLICY security_events_read ON osirus.security_events
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY security_events_insert ON osirus.security_events
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    osirus.is_system()
    OR (osirus.can_access_workspace(workspace_id)
        AND actor_id = osirus.current_user_id())
  );

ALTER TABLE osirus.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.automations FORCE ROW LEVEL SECURITY;
CREATE POLICY automations_read ON osirus.automations
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY automations_write ON osirus.automations
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON osirus.notifications
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id())
  WITH CHECK (
    osirus.is_system()
    OR (user_id = osirus.current_user_id()
        AND osirus.can_access_workspace(workspace_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.mcp_servers TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.mcp_server_tools TO osirus_app;
GRANT SELECT, INSERT ON osirus.connector_health TO osirus_app;
-- Default privileges from 007 would also grant UPDATE and DELETE; health
-- checks and security events are append-only, so take those back.
REVOKE UPDATE, DELETE ON osirus.connector_health FROM osirus_app;
REVOKE UPDATE, DELETE ON osirus.security_events FROM osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.workspace_policies TO osirus_app;
GRANT SELECT, INSERT ON osirus.security_events TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.automations TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.notifications TO osirus_app;
