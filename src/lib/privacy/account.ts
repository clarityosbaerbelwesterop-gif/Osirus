import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { displayUrl } from "../connectors/mcp-store";
import { queryAs } from "../db/client";
import { currentSubscription } from "../billing/store";

/** Subscription states that still bill or can bill again. */
export const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

// GDPR self-service: a copy of everything Osirus holds about a person
// (Art. 15, portable as JSON under Art. 20) and deleting the account
// (Art. 17). Every read runs as the person, behind row-level security, so the
// export cannot contain anyone else's rows. Secrets (sealed tokens,
// embeddings) are left out: they are not personal data in readable form and
// handing out a sealed credential helps no one.

/**
 * How a table's rows are found: by the person's id ("self", "user"), by
 * their workspace ("workspace"), or through the workspace's runs ("run",
 * for tables keyed only by run_id).
 */
type Scope = "workspace" | "user" | "self" | "run";

const EXPORT_TABLES: Array<{
  key: string;
  table: string;
  scope: Scope;
  order?: string;
  /** Extra condition on the table's own columns (constant SQL). */
  filter?: string;
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
  // Audit 2026-11-17: the work itself (steps, their results, tool calls)
  // and the records about the person (security log, usage, memberships)
  // were missing from the copy.
  {
    key: "runSteps",
    table: "run_stages",
    scope: "run",
    order: "created_at",
  },
  {
    key: "runEvents",
    table: "run_events",
    scope: "run",
    order: "created_at",
    // What the person saw while the run worked; internal scheduling events
    // carry no personal data of their own.
    filter: "t.visibility = 'user'",
  },
  {
    key: "toolCalls",
    table: "tool_calls",
    scope: "workspace",
    order: "created_at",
  },
  { key: "reviews", table: "reviews", scope: "workspace", order: "created_at" },
  {
    key: "memoryRelations",
    table: "memory_relations",
    scope: "workspace",
  },
  {
    key: "groupChatMembers",
    table: "group_chat_members",
    scope: "workspace",
  },
  {
    key: "webhooks",
    table: "webhook_endpoints",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "webhookDeliveries",
    table: "webhook_deliveries",
    scope: "workspace",
    order: "received_at",
  },
  {
    key: "usageLedger",
    table: "usage_ledger",
    scope: "workspace",
    order: "occurred_at",
  },
  {
    key: "securityLog",
    table: "security_events",
    scope: "workspace",
    order: "created_at",
  },
  {
    key: "workspaceMemberships",
    table: "workspace_memberships",
    scope: "user",
  },
  {
    key: "organizationMemberships",
    table: "organization_memberships",
    scope: "user",
  },
  { key: "legalAcceptances", table: "legal_acceptances", scope: "user" },
  { key: "subscriptions", table: "billing_subscriptions", scope: "user" },
  { key: "billingCustomer", table: "billing_customers", scope: "user" },
  { key: "cancellations", table: "contract_cancellations", scope: "user" },
];

/** Columns that hold sealed secrets or vectors, never part of the copy. */
const WITHHELD = [
  "credential_reference",
  // The signing secret of a webhook, sealed; and a share link's token,
  // which grants read access to the chat: neither belongs in a file that
  // may travel further.
  "secret_sealed",
  "token",
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
  const scoped =
    entry.scope === "self"
      ? "t.id = $1::uuid"
      : entry.scope === "user"
        ? "t.user_id = $1::uuid"
        : entry.scope === "run"
          ? "t.run_id in (select r.id from osirus.runs r where r.workspace_id = $1::uuid)"
          : "t.workspace_id = $1::uuid";
  const where = entry.filter ? `${scoped} and ${entry.filter}` : scoped;
  const strip = WITHHELD.map((column) => ` - '${column}'`).join("");
  return `select coalesce(jsonb_agg(row_json), '[]'::jsonb) as rows
            from (select to_jsonb(t)${strip} as row_json
                    from osirus.${entry.table} t
                   where ${where}
                   ${entry.order ? `order by t.${entry.order}` : ""}
                   limit ${ROW_LIMIT}) picked`;
}

/**
 * MCP server URLs often carry the server's API key (query, user info or a
 * path segment). The export promises no stored credentials, so they are
 * masked exactly as the connections page shows them.
 */
function maskUrls(key: string, rows: unknown[]) {
  if (key !== "mcpServers") return rows;
  return rows.map((row) =>
    row &&
    typeof row === "object" &&
    typeof (row as { url?: unknown }).url === "string"
      ? { ...row, url: displayUrl((row as { url: string }).url) }
      : row,
  );
}

export async function exportAccountData(identity: ProductIdentity) {
  const data: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const entry of EXPORT_TABLES) {
    try {
      const rows = await queryAs<{ rows: unknown[] }>(
        identity.userId,
        exportStatement(entry),
        [
          entry.scope === "workspace" || entry.scope === "run"
            ? identity.workspaceId
            : identity.userId,
        ],
      );
      data[entry.key] = maskUrls(entry.key, rows[0]?.rows ?? []);
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
 * Delete the account. Every subscription that still bills (or can bill
 * again) is ended first, but only when the person said so explicitly;
 * otherwise the deletion stops and says why, so nobody loses a paid plan by
 * accident. When the subscriptions cannot be read, nothing is deleted: a
 * deleted account with a subscription still charging in Stripe could not be
 * stopped by its owner any more.
 */
/** Deleting needs a sign-in this recent (GitHub's "sudo mode", 15 min). */
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

/**
 * True when the session was opened recently enough to delete the account.
 * A session of unknown age counts as old: the person signs in again.
 */
export function recentlySignedIn(
  sessionCreatedAt: Date | string | null | undefined,
  now = Date.now(),
) {
  if (!sessionCreatedAt) return false;
  const at = new Date(sessionCreatedAt).getTime();
  return (
    Number.isFinite(at) && now - at <= REAUTH_WINDOW_MS && at <= now + 60_000
  );
}

export async function deleteAccount(
  identity: ProductIdentity,
  options: { endSubscription: boolean },
  deps: {
    cancelSubscription?: (subscriptionId: string) => Promise<void>;
    /** All of the customer's subscriptions that still bill, from Stripe. */
    liveSubscriptions?: () => Promise<string[]>;
    /**
     * Removes the person's customer record at Stripe (name, e-mail, saved
     * payment methods). Invoices stay with Stripe under § 147 AO.
     */
    deleteCustomer?: () => Promise<void>;
  } = {},
) {
  let live: string[];
  if (deps.liveSubscriptions) {
    live = await deps.liveSubscriptions();
  } else {
    // Without Stripe: the stored subscription is all there is to go by.
    const subscription = await currentSubscription(identity.userId);
    live =
      subscription && LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
        ? [subscription.stripe_subscription_id]
        : [];
  }
  if (live.length) {
    if (!options.endSubscription)
      throw new AccountDeletionBlocked(
        "subscription_active",
        "Du hast ein laufendes Abo. Bestätige, dass es mit dem Löschen sofort endet, oder kündige es zuerst.",
      );
    if (!deps.cancelSubscription) throw new Error("billing_not_configured");
    for (const id of live) await deps.cancelSubscription(id);
  }
  // Before the database rows go: the customer id is read from them. A
  // failure stops the deletion, so nothing is left half done.
  if (deps.deleteCustomer) await deps.deleteCustomer();
  // Workspace content first: organizations.created_by restricts the user row.
  await queryAs(
    identity.userId,
    `delete from osirus.organizations where created_by = $1::uuid`,
    [identity.userId],
  );
  // Then the sign-in itself; it cascades to sessions and osirus.users.
  await queryAs(identity.userId, `select osirus.delete_own_auth_user()`, []);
}
