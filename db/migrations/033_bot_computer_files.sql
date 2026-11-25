-- A bot's cloud computer keeps only its working folder, not a whole VM
-- snapshot: the folder is packed (tar.gz) after each use and unpacked into a
-- fresh machine on the next. A full snapshot is ~845 MB and the Hobby plan's
-- snapshot storage held about a dozen; a working folder is kilobytes to a
-- few megabytes. One row per bot; it goes with the bot and the workspace.
CREATE TABLE IF NOT EXISTS osirus.bot_computer_files (
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  archive bytea NOT NULL,
  size_bytes integer NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bot_computer_files_pkey PRIMARY KEY (agent_id),
  CONSTRAINT bot_computer_files_size_check
    CHECK (size_bytes >= 0 AND size_bytes <= 26214400),
  CONSTRAINT bot_computer_files_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES osirus.agents (id) ON DELETE CASCADE,
  CONSTRAINT bot_computer_files_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES osirus.workspaces (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bot_computer_files_updated_at
  ON osirus.bot_computer_files (updated_at);

ALTER TABLE osirus.bot_computer_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.bot_computer_files FORCE ROW LEVEL SECURITY;

CREATE POLICY bot_computer_files_read ON osirus.bot_computer_files
  AS PERMISSIVE FOR SELECT TO public
  USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY bot_computer_files_write ON osirus.bot_computer_files
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (osirus.can_access_workspace(workspace_id));
CREATE POLICY bot_computer_files_update ON osirus.bot_computer_files
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.can_access_workspace(workspace_id))
  WITH CHECK (osirus.can_access_workspace(workspace_id));
-- The scheduler's retention step deletes, as the system, folders unused for
-- seven days (src/lib/privacy/retention.ts).
CREATE POLICY bot_computer_files_delete ON osirus.bot_computer_files
  AS PERMISSIVE FOR DELETE TO public
  USING (osirus.is_system() OR osirus.can_access_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.bot_computer_files TO osirus_app;
