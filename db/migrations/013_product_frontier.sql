-- Product frontier: attachments, signed webhooks, entitlements.
--
-- Additive. Attachments are tenant data under the same workspace policies
-- as runs: the bytes stay in Postgres (10 MB cap per file, checked twice),
-- the parsed text is split into chunks with a full-text index so a run
-- retrieves only the relevant parts instead of the whole document. Webhook
-- endpoints carry a sealed signing secret (never readable back); every
-- delivery is recorded once by its delivery id, so a replay is refused.
-- Entitlements describe limits per organization; there is no billing here.

CREATE TABLE IF NOT EXISTS osirus.attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid,
  uploaded_by uuid NOT NULL,
  filename text NOT NULL,
  media_type text NOT NULL,
  kind text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  status text NOT NULL DEFAULT 'stored',
  parsed_text text,
  structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT attachments_size_check CHECK (byte_size > 0 AND byte_size <= 10485760 AND octet_length(content) = byte_size),
  CONSTRAINT attachments_filename_check CHECK (char_length(filename) BETWEEN 1 AND 200),
  CONSTRAINT attachments_kind_check CHECK (kind = ANY (ARRAY['text'::text, 'markdown'::text, 'json'::text, 'csv'::text, 'pdf'::text, 'image'::text, 'code'::text])),
  CONSTRAINT attachments_status_check CHECK (status = ANY (ARRAY['stored'::text, 'parsed'::text, 'unsupported'::text, 'failed'::text])),
  CONSTRAINT attachments_parsed_text_check CHECK (parsed_text IS NULL OR char_length(parsed_text) <= 2000000),
  CONSTRAINT attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT attachments_session_id_fkey FOREIGN KEY (session_id) REFERENCES osirus.sessions(id) ON DELETE SET NULL,
  CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES osirus.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachments_workspace_idx
  ON osirus.attachments (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attachments_session_idx
  ON osirus.attachments (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS osirus.attachment_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  ordinal integer NOT NULL,
  content text NOT NULL,
  locator text,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  PRIMARY KEY (id),
  CONSTRAINT attachment_chunks_ordinal_key UNIQUE (attachment_id, ordinal),
  CONSTRAINT attachment_chunks_content_check CHECK (char_length(content) BETWEEN 1 AND 4000),
  CONSTRAINT attachment_chunks_attachment_fkey FOREIGN KEY (attachment_id) REFERENCES osirus.attachments(id) ON DELETE CASCADE,
  CONSTRAINT attachment_chunks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachment_chunks_search_idx
  ON osirus.attachment_chunks USING gin (search);

CREATE TABLE IF NOT EXISTS osirus.webhook_endpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  secret_sealed text NOT NULL,
  events text[] NOT NULL DEFAULT '{}'::text[],
  enabled boolean NOT NULL DEFAULT true,
  last_delivery_at timestamp with time zone,
  last_status text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT webhook_endpoints_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT webhook_endpoints_source_check CHECK (source = ANY (ARRAY['github'::text, 'vercel'::text, 'generic'::text])),
  CONSTRAINT webhook_endpoints_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS osirus.webhook_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  delivery_id text NOT NULL,
  event text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT webhook_deliveries_unique_key UNIQUE (endpoint_id, delivery_id),
  CONSTRAINT webhook_deliveries_outcome_check CHECK (outcome = ANY (ARRAY['triggered'::text, 'ignored'::text, 'rejected'::text])),
  CONSTRAINT webhook_deliveries_endpoint_fkey FOREIGN KEY (endpoint_id) REFERENCES osirus.webhook_endpoints(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON osirus.webhook_deliveries (endpoint_id, received_at DESC);

CREATE TABLE IF NOT EXISTS osirus.entitlements (
  organization_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id),
  CONSTRAINT entitlements_plan_check CHECK (plan = ANY (ARRAY['free'::text, 'team'::text, 'enterprise'::text])),
  CONSTRAINT entitlements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES osirus.organizations(id) ON DELETE CASCADE
);

-- Automations can now be started by a signed webhook delivery.
ALTER TABLE osirus.automations DROP CONSTRAINT IF EXISTS automations_trigger_check;
ALTER TABLE osirus.automations ADD CONSTRAINT automations_trigger_check CHECK (trigger_kind = ANY (ARRAY['schedule'::text, 'run_completed'::text, 'connector_changed'::text, 'webhook'::text]));

-- Row-level security.

ALTER TABLE osirus.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY attachments_read ON osirus.attachments
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY attachments_insert ON osirus.attachments
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.can_access_workspace(workspace_id) AND uploaded_by = osirus.current_user_id());
CREATE POLICY attachments_update ON osirus.attachments
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.can_access_workspace(workspace_id))
  WITH CHECK (osirus.can_access_workspace(workspace_id));
CREATE POLICY attachments_delete ON osirus.attachments
  AS PERMISSIVE FOR DELETE TO public
  USING (uploaded_by = osirus.current_user_id() OR osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.attachment_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.attachment_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY attachment_chunks_access ON osirus.attachment_chunks
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_workspace(workspace_id))
  WITH CHECK (osirus.can_access_workspace(workspace_id));

ALTER TABLE osirus.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoints_access ON osirus.webhook_endpoints
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system() OR osirus.can_manage_workspace(workspace_id))
  WITH CHECK (osirus.is_system() OR osirus.can_manage_workspace(workspace_id));

ALTER TABLE osirus.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_read ON osirus.webhook_deliveries
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus.can_manage_workspace(workspace_id));
CREATE POLICY webhook_deliveries_insert ON osirus.webhook_deliveries
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.is_system());

ALTER TABLE osirus.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY entitlements_read ON osirus.entitlements
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus.can_access_organization(organization_id));
CREATE POLICY entitlements_write ON osirus.entitlements
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.is_system())
  WITH CHECK (osirus.is_system());

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.attachments TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.attachment_chunks TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.webhook_endpoints TO osirus_app;
GRANT SELECT, INSERT ON osirus.webhook_deliveries TO osirus_app;
GRANT SELECT, INSERT, UPDATE ON osirus.entitlements TO osirus_app;
