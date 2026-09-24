import "server-only";
import { queryAs } from "../db/client";

// Entitlements: what an organization's plan allows. There is no billing
// behind this -- every organization is on the free plan unless an operator
// sets a row -- but the limits are real and enforced where things are
// created, so a paid plan later changes a row, not the code.

export type Plan = "free" | "team" | "enterprise";

export type Limits = {
  automations: number;
  webhookEndpoints: number;
  attachmentsPerDay: number;
  attachmentBytes: number;
};

export const PLAN_LIMITS: Record<Plan, Limits> = {
  free: {
    automations: 20,
    webhookEndpoints: 10,
    attachmentsPerDay: 100,
    attachmentBytes: 10 * 1024 * 1024,
  },
  team: {
    automations: 200,
    webhookEndpoints: 50,
    attachmentsPerDay: 1_000,
    attachmentBytes: 10 * 1024 * 1024,
  },
  enterprise: {
    automations: 2_000,
    webhookEndpoints: 500,
    attachmentsPerDay: 10_000,
    attachmentBytes: 10 * 1024 * 1024,
  },
};

type Identity = { userId: string; organizationId: string; workspaceId: string };

export async function entitlementsFor(identity: Identity) {
  const [row] = await queryAs<{ plan: Plan; limits: Partial<Limits> }>(
    identity.userId,
    `select plan, limits from osirus.entitlements where organization_id = $1::uuid`,
    [identity.organizationId],
  ).catch(() => []);
  const plan = row?.plan ?? "free";
  return {
    plan,
    limits: { ...PLAN_LIMITS[plan], ...(row?.limits ?? {}) } as Limits,
  };
}

export class EntitlementError extends Error {
  constructor(readonly limit: keyof Limits) {
    super(`entitlement_exceeded:${limit}`);
  }
}

const COUNT: Record<
  "automations" | "webhookEndpoints" | "attachmentsPerDay",
  string
> = {
  automations: `select count(*) as n from osirus.automations where organization_id = $1::uuid`,
  webhookEndpoints: `select count(*) as n from osirus.webhook_endpoints where organization_id = $1::uuid`,
  attachmentsPerDay: `select count(*) as n from osirus.attachments where organization_id = $1::uuid and created_at > now() - interval '1 day'`,
};

/** Throws EntitlementError when creating one more would exceed the plan. */
export async function assertWithinLimit(
  identity: Identity,
  limit: keyof typeof COUNT,
) {
  const { limits } = await entitlementsFor(identity);
  const [row] = await queryAs<{ n: string }>(identity.userId, COUNT[limit], [
    identity.organizationId,
  ]);
  if (Number(row?.n ?? 0) >= limits[limit]) throw new EntitlementError(limit);
}
