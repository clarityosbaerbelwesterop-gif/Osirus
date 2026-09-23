-- Agent intelligence: research evidence, coding workspaces, plan revisions.
--
-- Research documents live in the database rather than in the run checkpoint
-- because research fans out: several workers gather in parallel, and a
-- checkpoint is a single linear state that the last writer wins. Documents
-- written here by every worker are all visible to the synthesis stage.

CREATE TABLE IF NOT EXISTS osirus.research_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  stage_id uuid,
  url text NOT NULL,
  title text,
  publisher text,
  published_at timestamp with time zone,
  retrieved_at timestamp with time zone NOT NULL,
  content_hash text NOT NULL,
  authority text NOT NULL,
  provider text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT research_documents_authority_check CHECK (authority = ANY (ARRAY['primary'::text, 'official_docs'::text, 'reference'::text, 'news'::text, 'community'::text, 'secondary'::text])),
  CONSTRAINT research_documents_content_size_check CHECK (char_length(content) <= 400000),
  CONSTRAINT research_documents_run_url_hash_key UNIQUE (run_id, url, content_hash),
  CONSTRAINT research_documents_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE,
  CONSTRAINT research_documents_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES osirus.run_stages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS research_documents_run_idx ON osirus.research_documents (run_id, retrieved_at);

CREATE TABLE IF NOT EXISTS osirus.research_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  statement text NOT NULL,
  status text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT research_claims_status_check CHECK (status = ANY (ARRAY['SUPPORTED'::text, 'CONTESTED'::text, 'INSUFFICIENT'::text, 'STALE'::text])),
  CONSTRAINT research_claims_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS research_claims_run_idx ON osirus.research_claims (run_id);

CREATE TABLE IF NOT EXISTS osirus.evidence_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  document_id uuid NOT NULL,
  relation text NOT NULL,
  excerpt text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT evidence_links_relation_check CHECK (relation = ANY (ARRAY['supports'::text, 'contradicts'::text])),
  CONSTRAINT evidence_links_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE,
  CONSTRAINT evidence_links_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES osirus.research_claims(id) ON DELETE CASCADE,
  CONSTRAINT evidence_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES osirus.research_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS evidence_links_claim_idx ON osirus.evidence_links (claim_id);
CREATE INDEX IF NOT EXISTS evidence_links_run_idx ON osirus.evidence_links (run_id);

-- A coding workspace outlives a stage. Only an opaque handle is stored: the
-- sandbox name the driver uses to reattach, never a credential.
CREATE TABLE IF NOT EXISTS osirus.coding_workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  driver text NOT NULL,
  handle text NOT NULL,
  status text NOT NULL,
  repository text,
  branch text,
  repository_map jsonb,
  commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  command_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_tree jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff text,
  preview_url text,
  snapshot_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  PRIMARY KEY (id),
  CONSTRAINT coding_workspaces_handle_key UNIQUE (handle),
  CONSTRAINT coding_workspaces_diff_check CHECK (diff IS NULL OR char_length(diff) <= 400000),
  CONSTRAINT coding_workspaces_preview_check CHECK (preview_url IS NULL OR preview_url ~ '^https://'),
  CONSTRAINT coding_workspaces_status_check CHECK (status = ANY (ARRAY['creating'::text, 'ready'::text, 'stopped'::text, 'destroyed'::text, 'failed'::text])),
  CONSTRAINT coding_workspaces_handle_check CHECK (char_length(handle) BETWEEN 1 AND 200),
  CONSTRAINT coding_workspaces_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS coding_workspaces_run_idx ON osirus.coding_workspaces (run_id, created_at);

CREATE TRIGGER coding_workspaces_touch_updated_at
  BEFORE UPDATE ON osirus.coding_workspaces
  FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();

-- Replanning never erases a plan. Each revision is a new row with its reason.
CREATE TABLE IF NOT EXISTS osirus.plan_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  revision integer NOT NULL,
  reason text NOT NULL,
  graph jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT plan_revisions_revision_check CHECK (revision >= 1),
  CONSTRAINT plan_revisions_run_revision_key UNIQUE (run_id, revision),
  CONSTRAINT plan_revisions_run_id_fkey FOREIGN KEY (run_id) REFERENCES osirus.runs(id) ON DELETE CASCADE
);

ALTER TABLE osirus.research_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.research_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY research_documents_access ON osirus.research_documents
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

ALTER TABLE osirus.research_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.research_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY research_claims_access ON osirus.research_claims
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

ALTER TABLE osirus.evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_links_access ON osirus.evidence_links
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

ALTER TABLE osirus.coding_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.coding_workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY coding_workspaces_access ON osirus.coding_workspaces
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

ALTER TABLE osirus.plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_revisions_access ON osirus.plan_revisions
  AS PERMISSIVE FOR ALL TO public
  USING (osirus.can_access_run(run_id))
  WITH CHECK (osirus.can_manage_run(run_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.research_documents TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.research_claims TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.evidence_links TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.coding_workspaces TO osirus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.plan_revisions TO osirus_app;
