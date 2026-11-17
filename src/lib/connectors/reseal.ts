import "server-only";
import { querySystem } from "../db/client";
import {
  connectorKeyConfigured,
  decryptSecret,
  encryptSecret,
  needsReseal,
  type SecretPurpose,
} from "./crypto";

// Sealed secrets written before crypto v2 (no workspace binding, one key for
// everything), or under a key that has since been rotated, are sealed again
// with the current key and their workspace as authenticated data. Run by the
// scheduler tick in small batches; a row that cannot be opened is left as it
// is and counted, never overwritten.

const BATCH = 50;

type Source = {
  name: string;
  table: string;
  column: string;
  purpose: (row: Record<string, unknown>) => SecretPurpose | null;
};

const PLATFORM = new Set(["github", "vercel", "neon", "supabase"]);

const SOURCES: Source[] = [
  {
    name: "connectors",
    table: "connector_installations",
    column: "credential_reference",
    purpose: (row) =>
      PLATFORM.has(String(row.connector_id))
        ? (`connector:${row.connector_id}` as SecretPurpose)
        : null,
  },
  {
    name: "mcpServers",
    table: "mcp_servers",
    column: "credential_reference",
    purpose: () => "mcp",
  },
  {
    name: "webhooks",
    table: "webhook_endpoints",
    column: "secret_sealed",
    purpose: () => "webhook",
  },
];

export async function resealLegacySecrets() {
  const result: Record<string, { resealed: number; unreadable: number }> = {};
  if (!connectorKeyConfigured()) return result;
  for (const source of SOURCES) {
    const counts = { resealed: 0, unreadable: 0 };
    result[source.name] = counts;
    const rows = await querySystem<Record<string, unknown>>(
      `select * from osirus.${source.table}
        where ${source.column} is not null
          and ${source.column} not like 'v2.%'
        limit ${BATCH}`,
    ).catch(() => []);
    // Rows under a rotated key are v2 with another key id: found by the
    // check below, which also covers the v1 rows selected above.
    const rotated = await querySystem<Record<string, unknown>>(
      `select * from osirus.${source.table}
        where ${source.column} like 'v2.%'
        limit 500`,
    ).catch(() => []);
    for (const row of [...rows, ...rotated]) {
      const sealed = String(row[source.column] ?? "");
      if (!sealed || !needsReseal(sealed)) continue;
      const purpose = source.purpose(row);
      const workspaceId = String(row.workspace_id ?? "");
      if (!purpose || !workspaceId) continue;
      const context = { purpose, workspaceId };
      let plaintext: string;
      try {
        plaintext = decryptSecret(sealed, context);
      } catch {
        counts.unreadable += 1;
        continue;
      }
      // Only if nobody changed the value meanwhile.
      const updated = await querySystem<{ id: string }>(
        `update osirus.${source.table}
            set ${source.column} = $2
          where id = $1::uuid and ${source.column} = $3
          returning id`,
        [row.id, encryptSecret(plaintext, context), sealed],
      ).catch(() => []);
      if (updated.length) counts.resealed += 1;
    }
  }
  return result;
}
