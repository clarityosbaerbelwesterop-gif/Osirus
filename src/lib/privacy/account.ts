import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import { currentSubscription } from "../billing/store";
import { BILLING_CONFIG } from "../billing/config";

// GDPR self-service: a copy of everything Osirus holds about a person
// (Art. 15, portable as JSON under Art. 20) and deleting the account
// (Art. 17). Every read runs as the person, behind row-level security, so the
// export cannot contain anyone else's rows. Secrets (sealed tokens,
// embeddings) are left out: they are not personal data in readable form and
// handing out a sealed credential helps no one.

type Scope = "workspace" | "user" | "self";

const EXPORT_TABLES: Array<{
  key: string;
  table: string;
  scope: Scope;
  order?: string;
}> = [
  { key: "profile", table: "users", scope: "self" },
  {
    key: "conversations",
    table: "sessions",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "messages",
    table: "messages",
    scope: "workspace",
    order: "created_at",
  },
  { key: "runs", table: "runs", scope: "workspace", order: "created_at" },
  {
    key: "artifacts",
    table: "artifacts",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "approvals",
    table: "approvals",
    scope: "workspace",
    order: "created_at",
  },
  { key: "bots", table: "agents", scope: "workspace", order: "created_at" },
  {
    key: "groupChats",
    table: "group_chats",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "groupChatMessages",
    table: "group_chat_messages",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "memory",
    table: "memory_items",
    scope: "workspace",
    order: "created_at",
  },
  { key: "memoryEntities", table: "memory_entities", scope: "workspace" },
  { key: "memorySummaries", table: "memory_summaries", scope: "workspace" },
  {
    key: "files",
    table: "attachments",
    scope: "workspace",
    order: "created_at",
  },
  { key: "fileText", table: "attachment_chunks", scope: "workspace" },
  { key: "sharedLinks", table: "chat_shares", scope: "workspace" },
  { key: "automations", table: "automations", scope: "workspace" },
  { key: "connections", table: "connector_installations", scope: "workspace" },
  { key: "mcpServers", table: "mcp_servers", scope: "workspace" },
  {
    key: "modelUsage",
    table: "model_calls",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "notifications",
    table: "notifications",
    scope: "user",
    order: "created_at",
  },
  { key: "legalAcceptances", table: "legal_acceptances", scope: "user" },
  { key: "subscriptions", table: "billing_subscriptions", scope: "user" },
  { key: "billingCustomer", table: "billing_customers", scope: "user" },
  { key: "cancellations", table: "contract_cancellations", scope: "user" },
];

/** Columns that hold sealed secrets or vectors, never part of the copy. */
const WITHHELD = [
  "credential_reference",
  "embedding",
  "network_hash",
  "token_hash",
  "secret_hash",
];

const ROW_LIMIT = 20_000;

/**
 * One table's rows as JSON, filtered by exactly one parameter: the user id
 * for "self" and "user", the workspace id for "workspace". (Postgres rejects
 * a statement that is handed a parameter it never uses.)
 */
export function exportStatement(entry: (typeof EXPORT_TABLES)[number]) {
  const where =
    entry.scope === "self"
      ? "t.id = $1::uuid"
      : entry.scope === "user"
        ? "t.user_id = $1::uuid"
        : "t.workspace_id = $1::uuid";
  const strip = WITHHELD.map((column) => ` - '${column}'`).join("");
  return `select coalesce(jsonb_agg(row_json), '[]'::jsonb) as rows
            from (select to_jsonb(t)${strip} as row_json
                    from osirus.${entry.table} t
                   where ${where}
                   ${entry.order ? `order by t.${entry.order}` : ""}
                   limit ${ROW_LIMIT}) picked`;
}

export async function exportAccountData(identity: ProductIdentity) {
  const data: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const entry of EXPORT_TABLES) {
    try {
      const rows = await queryAs<{ rows: unknown[] }>(
        identity.userId,
        exportStatement(entry),
        [entry.scope === "workspace" ? identity.workspaceId : identity.userId],
      );
      data[entry.key] = rows[0]?.rows ?? [];
    } catch (error) {
      // A table this deployment does not have yet; say so instead of failing.
      console.warn(
        "account.export table skipped",
        entry.table,
        error instanceof Error ? error.message.slice(0, 160) : "unknown",
      );
      skipped.push(entry.key);
    }
  }
  return {
    format: "osirus-account-export/1",
    exportedAt: new Date().toISOString(),
    legalBasis:
      "Auskunft und Datenübertragbarkeit nach Art. 15 und Art. 20 DSGVO.",
    note: "Gespeicherte Zugangsdaten (Tokens) liegen nur verschlüsselt vor und sind nicht enthalten. Rechnungen stellt Stripe aus und bewahrt sie auf.",
    ...(skipped.length ? { notAvailable: skipped } : {}),
    data,
  };
}

export class AccountDeletionBlocked extends Error {
  constructor(
    readonly code: "subscription_active",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Delete the account. A running paid subscription is ended first, but only
 * when the person said so explicitly; otherwise the deletion stops and says
 * why, so nobody loses a paid plan by accident.
 */
export async function deleteAccount(
  identity: ProductIdentity,
  options: { endSubscription: boolean },
  deps: {
    cancelSubscription?: (subscriptionId: string) => Promise<void>;
  } = {},
) {
  const subscription = await currentSubscription(identity.userId).catch(
    () => null,
  );
  const paid = Boolean(
    subscription?.plan &&
    BILLING_CONFIG.entitledStatuses.includes(subscription.status),
  );
  if (paid) {
    if (!options.endSubscription)
      throw new AccountDeletionBlocked(
        "subscription_active",
        "Du hast ein laufendes Abo. Bestätige, dass es mit dem Löschen sofort endet, oder kündige es zuerst.",
      );
    if (!deps.cancelSubscription) throw new Error("billing_not_configured");
    await deps.cancelSubscription(subscription!.stripe_subscription_id);
  }
  // Workspace content first: organizations.created_by restricts the user row.
  await queryAs(
    identity.userId,
    `delete from osirus.organizations where created_by = $1::uuid`,
    [identity.userId],
  );
  // Then the sign-in itself; it cascades to sessions and osirus.users.
  await queryAs(identity.userId, `select osirus.delete_own_auth_user()`, []);
}
