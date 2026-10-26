-- Read-only links to a chat. A link shows the thread as it was when it was
-- shared (messages up to shared_until) and stops working once revoked. One
-- active link per chat; sharing again moves shared_until forward.
CREATE TABLE IF NOT EXISTS osirus.chat_shares (
  token text PRIMARY KEY,
  session_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  shared_until timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  CONSTRAINT chat_shares_token_check CHECK (char_length(token) BETWEEN 24 AND 64),
  CONSTRAINT chat_shares_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES osirus.sessions (id) ON DELETE CASCADE,
  CONSTRAINT chat_shares_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE,
  CONSTRAINT chat_shares_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES osirus.users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_shares_one_active
  ON osirus.chat_shares (session_id) WHERE revoked_at IS NULL;

ALTER TABLE osirus.chat_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.chat_shares FORCE ROW LEVEL SECURITY;

-- Members see and revoke their workspace's links and create links in their
-- own name; the public page reads through system access, by token only.
CREATE POLICY chat_shares_access ON osirus.chat_shares
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.is_system() OR osirus.can_access_workspace(workspace_id));

CREATE POLICY chat_shares_create ON osirus.chat_shares
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    osirus.is_system()
    OR (
      osirus.can_access_workspace(workspace_id)
      AND created_by = osirus.current_user_id()
    )
  );

CREATE POLICY chat_shares_update ON osirus.chat_shares
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.is_system() OR osirus.can_access_workspace(workspace_id))
  WITH CHECK (osirus.is_system() OR osirus.can_access_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE ON osirus.chat_shares TO osirus_app;
