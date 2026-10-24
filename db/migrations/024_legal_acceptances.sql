-- Consent to the terms (AGB), the EULA, and the privacy notice.
-- One current row per user and document. accepted_at is the timestamp.
-- version is the text version they accepted. Re-acceptance updates both.
-- This file is applied by the operator. It is not run from the application.

CREATE TABLE IF NOT EXISTS osirus.legal_acceptances (
  user_id uuid NOT NULL,
  document text NOT NULL,
  version text NOT NULL,
  accepted_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document),
  CONSTRAINT legal_acceptances_document_check CHECK (
    document = ANY (ARRAY['terms'::text, 'eula'::text, 'privacy'::text])
  ),
  CONSTRAINT legal_acceptances_version_check CHECK (
    char_length(version) BETWEEN 1 AND 40
  ),
  CONSTRAINT legal_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES osirus.users (id) ON DELETE CASCADE
);

ALTER TABLE osirus.legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.legal_acceptances FORCE ROW LEVEL SECURITY;

CREATE POLICY legal_acceptances_read ON osirus.legal_acceptances
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id());

CREATE POLICY legal_acceptances_insert ON osirus.legal_acceptances
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.is_system() OR user_id = osirus.current_user_id());

CREATE POLICY legal_acceptances_update ON osirus.legal_acceptances
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.is_system() OR user_id = osirus.current_user_id())
  WITH CHECK (osirus.is_system() OR user_id = osirus.current_user_id());

GRANT SELECT, INSERT, UPDATE ON osirus.legal_acceptances TO osirus_app;
