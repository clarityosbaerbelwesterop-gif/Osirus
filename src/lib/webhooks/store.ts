import "server-only";
import { randomBytes } from "node:crypto";
import { queryAs, querySystem } from "../db/client";
import {
  connectorKeyConfigured,
  decryptSecret,
  encryptSecret,
} from "../connectors/crypto";
import type { NormalizedEvent, WebhookSource } from "./verify";

// Webhook endpoints of a workspace. The signing secret is generated here,
// shown to the person once, and stored sealed; it is never returned again.
// The receiver reads an endpoint as the system (the caller is anonymous and
// proves itself by the signature), records each delivery once, and starts
// the workspace's webhook automations as their creators.

type Identity = { userId: string; organizationId: string; workspaceId: string };

export type WebhookEndpointView = {
  id: string;
  name: string;
  source: WebhookSource;
  events: string[];
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
};

type Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  source: WebhookSource;
  secret_sealed: string;
  events: string[];
  enabled: boolean;
  last_delivery_at: string | null;
  last_status: string | null;
};

const view = (row: Row): WebhookEndpointView => ({
  id: row.id,
  name: row.name,
  source: row.source,
  events: row.events ?? [],
  enabled: row.enabled,
  lastDeliveryAt: row.last_delivery_at
    ? new Date(row.last_delivery_at).toISOString()
    : null,
  lastStatus: row.last_status,
});

export const WEBHOOK_EVENTS = [
  "push",
  "pull_request",
  "ci_failure",
  "deployment",
  "db_event",
  "generic",
] as const;

export async function createEndpoint(
  identity: Identity,
  input: { name: string; source: WebhookSource; events: string[] },
) {
  if (!connectorKeyConfigured())
    throw new Error("connector_key_not_configured");
  const secret = randomBytes(32).toString("hex");
  const [row] = await queryAs<Row>(
    identity.userId,
    `insert into osirus.webhook_endpoints
       (organization_id, workspace_id, created_by, name, source,
        secret_sealed, events)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::text[])
     returning *`,
    [
      identity.organizationId,
      identity.workspaceId,
      identity.userId,
      input.name,
      input.source,
      encryptSecret(secret),
      input.events,
    ],
  );
  if (!row) throw new Error("webhook_insert_failed");
  return { endpoint: view(row), secret };
}

export async function listEndpoints(identity: Identity) {
  const rows = await queryAs<Row>(
    identity.userId,
    `select * from osirus.webhook_endpoints
      where workspace_id = $1::uuid order by created_at desc`,
    [identity.workspaceId],
  );
  return rows.map(view);
}

export async function deleteEndpoint(identity: Identity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.webhook_endpoints
      where id = $1::uuid and workspace_id = $2::uuid returning id`,
    [id, identity.workspaceId],
  );
  return rows.length > 0;
}

/** The endpoint and its secret, for the receiver only. */
export async function endpointForDelivery(id: string) {
  const [row] = await querySystem<Row>(
    `select * from osirus.webhook_endpoints where id = $1::uuid and enabled`,
    [id],
  );
  if (!row || !connectorKeyConfigured()) return null;
  return { row, secret: decryptSecret(row.secret_sealed) };
}

/** Record a delivery once; false when this delivery id was seen before. */
export async function recordDelivery(
  row: Row,
  event: NormalizedEvent,
  outcome: "triggered" | "ignored" | "rejected",
) {
  const inserted = await querySystem<{ id: string }>(
    `insert into osirus.webhook_deliveries
       (endpoint_id, workspace_id, delivery_id, event, summary, outcome)
     values ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)
     on conflict (endpoint_id, delivery_id) do nothing
     returning id`,
    [
      row.id,
      row.workspace_id,
      event.deliveryId,
      event.kind,
      JSON.stringify({
        repository: event.repository,
        ref: event.ref,
        sha: event.sha,
        status: event.status,
      }),
      outcome,
    ],
  );
  if (inserted.length)
    await querySystem(
      `update osirus.webhook_endpoints
          set last_delivery_at = now(), last_status = $2
        where id = $1::uuid`,
      [row.id, outcome],
    );
  return inserted.length > 0;
}

export type EndpointRow = Row;
