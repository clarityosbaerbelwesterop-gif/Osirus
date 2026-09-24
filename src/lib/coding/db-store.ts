import "server-only";
import { queryAs } from "../db/client";
import type { WorkspaceRecord, WorkspaceRecordStore } from "./store";

// Workspace records through the run's row-level security. A caller who cannot
// see the run cannot see, reattach or overwrite its workspace -- the handle of
// another tenant's sandbox is not found, not refused.

type Row = {
  run_id: string;
  driver: string;
  handle: string;
  status: WorkspaceRecord["status"];
  repository: string | null;
  branch: string | null;
  repository_map: WorkspaceRecord["repositoryMap"];
  commands: WorkspaceRecord["commands"];
  command_log: WorkspaceRecord["commandLog"];
  file_tree: string[];
  diff: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
};

export function mapWorkspaceRow(row: Row): WorkspaceRecord {
  return {
    runId: row.run_id,
    driver: row.driver,
    handle: row.handle,
    status: row.status,
    repository: row.repository,
    branch: row.branch,
    repositoryMap: row.repository_map,
    softwareWorldModel: null,
    commands: row.commands ?? [],
    commandLog: row.command_log ?? [],
    fileTree: row.file_tree ?? [],
    diff: row.diff,
    previewUrl: row.preview_url,
    snapshotId: row.snapshot_id,
  };
}

export const WORKSPACE_COLUMNS = `run_id, driver, handle, status, repository, branch,
  repository_map, commands, command_log, file_tree, diff, preview_url, snapshot_id`;

export class DbWorkspaceStore implements WorkspaceRecordStore {
  constructor(private readonly actorId: string) {}

  async load(runId: string) {
    const rows = await queryAs<Row>(
      this.actorId,
      `select ${WORKSPACE_COLUMNS}
         from osirus.coding_workspaces
        where run_id = $1
        order by created_at desc
        limit 1`,
      [runId],
    );
    return rows[0] ? mapWorkspaceRow(rows[0]) : null;
  }

  async save(record: WorkspaceRecord) {
    await queryAs(
      this.actorId,
      `insert into osirus.coding_workspaces
         (run_id, driver, handle, status, repository, branch, repository_map,
          commands, command_log, file_tree, diff, preview_url, snapshot_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
               $10::jsonb, $11, $12, $13)
       on conflict (handle) do update set
         status = excluded.status,
         repository = excluded.repository,
         branch = excluded.branch,
         repository_map = excluded.repository_map,
         commands = excluded.commands,
         command_log = excluded.command_log,
         file_tree = excluded.file_tree,
         diff = excluded.diff,
         preview_url = excluded.preview_url,
         snapshot_id = excluded.snapshot_id`,
      [
        record.runId,
        record.driver,
        record.handle,
        record.status,
        record.repository,
        record.branch,
        JSON.stringify(record.repositoryMap),
        JSON.stringify(record.commands),
        JSON.stringify(record.commandLog.slice(-60)),
        JSON.stringify(record.fileTree.slice(0, 800)),
        record.diff ? record.diff.slice(0, 400_000) : null,
        record.previewUrl?.startsWith("https://") ? record.previewUrl : null,
        record.snapshotId,
      ],
    );
  }
}
