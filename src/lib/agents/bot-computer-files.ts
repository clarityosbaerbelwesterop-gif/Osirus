import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";

// A bot computer's working folder, kept by Osirus between uses (migration
// 033): packed after each use, unpacked into the next fresh machine. Seven
// days after the last use the scheduler's retention step deletes it.

/** Largest folder kept, packed (the table's check allows 25 MB). */
export const COMPUTER_FILES_MAX_BYTES = 20 * 1024 * 1024;

export type ComputerFiles = {
  /** The packed folder (tar.gz, base64), or null when there is none. */
  load(): Promise<string | null>;
  /** Keep the packed folder; false when it is too large to keep. */
  save(base64: string): Promise<boolean>;
};

export function databaseComputerFiles(
  identity: ProductIdentity,
  botId: string,
): ComputerFiles {
  return {
    async load() {
      const rows = await queryAs<{ archive: string }>(
        identity.userId,
        `select encode(archive, 'base64') as archive
           from osirus.bot_computer_files
          where agent_id = $1::uuid
            and workspace_id = $2::uuid
            and updated_at > now() - interval '7 days'`,
        [botId, identity.workspaceId],
      );
      return rows[0]?.archive?.replace(/\s+/g, "") || null;
    },
    async save(base64) {
      const bytes = Math.floor((base64.length * 3) / 4);
      if (!base64 || bytes > COMPUTER_FILES_MAX_BYTES) return false;
      await queryAs(
        identity.userId,
        `insert into osirus.bot_computer_files
           (workspace_id, agent_id, archive, size_bytes, updated_at)
         values ($1::uuid, $2::uuid, decode($3, 'base64'), $4, now())
         on conflict (agent_id) do update
           set archive = excluded.archive,
               size_bytes = excluded.size_bytes,
               updated_at = now()`,
        [identity.workspaceId, botId, base64, bytes],
      );
      return true;
    },
  };
}
