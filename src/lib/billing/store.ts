import "server-only";
import { querySystem } from "../db/client";
import { BILLING_CONFIG, type PaidPlan } from "./config";
import type { UsageCall } from "./quota";

// Database access for billing. Subscription and customer rows are written
// only by the Stripe webhook (system caller). Usage is read as the system
// because a user's model calls span every workspace their runs ran in.

export type SubscriptionRow = {
  stripe_subscription_id: string;
  user_id: string;
  stripe_customer_id: string;
  plan: PaidPlan | null;
  price_id: string | null;
  status: string;
  current_period_end: string | Date | null;
  cancel_at_period_end: boolean;
};

function isUnconfiguredTestDb(error: unknown): boolean {
  return (
    !process.env.DATABASE_URL &&
    error instanceof Error &&
    /DATABASE_URL is not configured/i.test(error.message)
  );
}

/**
 * The user's subscription that matters: an entitled one if any (the highest
 * plan wins when several exist), otherwise the most recently updated.
 */
export async function currentSubscription(
  userId: string,
): Promise<SubscriptionRow | null> {
  try {
    const rows = await querySystem<SubscriptionRow>(
      `select stripe_subscription_id, user_id, stripe_customer_id, plan, price_id,
              status, current_period_end, cancel_at_period_end
         from osirus.billing_subscriptions
        where user_id = $1
        order by (status = any($2::text[])) desc,
                 case plan when 'ultra_200' then 4 when 'ultra_100' then 3
                           when 'developer' then 2 when 'pro' then 1 else 0 end desc,
                 updated_at desc
        limit 1`,
      [userId, [...BILLING_CONFIG.entitledStatuses]],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isUnconfiguredTestDb(error)) return null;
    throw error;
  }
}

/** The user's model calls inside the longest quota window. */
export async function usageSince(
  userId: string,
  since: Date,
): Promise<UsageCall[]> {
  try {
    const rows = await querySystem<{
      created_at: string | Date;
      estimated_cost_usd: string | number | null;
    }>(
      `select mc.created_at, mc.estimated_cost_usd
         from osirus.model_calls mc
         left join osirus.runs r on r.id = mc.run_id
        where (
                r.requested_by = $1::uuid
                or (
                  mc.run_id is null
                  and (
                    mc.request_metadata->>'userId' = $1::text
                    or exists (
                      select 1
                        from osirus.workspace_memberships wm
                       where wm.workspace_id = mc.workspace_id
                         and wm.user_id = $1::uuid
                    )
                  )
                )
              )
          and mc.created_at > $2`,
      [userId, since.toISOString()],
    );
    return rows.map((row) => ({
      at: new Date(row.created_at),
      costUsd:
        row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    }));
  } catch (error) {
    if (isUnconfiguredTestDb(error)) return [];
    throw error;
  }
}

export async function customerIdFor(userId: string) {
  const rows = await querySystem<{ stripe_customer_id: string }>(
    "select stripe_customer_id from osirus.billing_customers where user_id = $1",
    [userId],
  );
  return rows[0]?.stripe_customer_id ?? null;
}

export async function userIdForCustomer(customerId: string) {
  const rows = await querySystem<{ user_id: string }>(
    "select user_id from osirus.billing_customers where stripe_customer_id = $1",
    [customerId],
  );
  return rows[0]?.user_id ?? null;
}

export async function saveCustomer(userId: string, customerId: string) {
  await querySystem(
    `insert into osirus.billing_customers (user_id, stripe_customer_id)
     values ($1, $2)
     on conflict (user_id) do update
       set stripe_customer_id = excluded.stripe_customer_id, updated_at = now()`,
    [userId, customerId],
  );
}

export type SubscriptionUpsert = {
  subscriptionId: string;
  userId: string;
  customerId: string;
  plan: PaidPlan | null;
  priceId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  eventCreated: Date;
};

/** Upsert, skipping a write from an event older than the stored state. */
export async function upsertSubscription(row: SubscriptionUpsert) {
  await querySystem(
    `insert into osirus.billing_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, plan, price_id,
        status, current_period_end, cancel_at_period_end, stripe_event_created)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (stripe_subscription_id) do update
       set user_id = excluded.user_id,
           stripe_customer_id = excluded.stripe_customer_id,
           plan = excluded.plan,
           price_id = excluded.price_id,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           stripe_event_created = excluded.stripe_event_created,
           updated_at = now()
     where osirus.billing_subscriptions.stripe_event_created is null
        or osirus.billing_subscriptions.stripe_event_created <= excluded.stripe_event_created`,
    [
      row.subscriptionId,
      row.userId,
      row.customerId,
      row.plan,
      row.priceId,
      row.status,
      row.currentPeriodEnd?.toISOString() ?? null,
      row.cancelAtPeriodEnd,
      row.eventCreated.toISOString(),
    ],
  );
}

/** Records the event; false when it was already processed. */
export async function claimEvent(id: string, type: string) {
  const rows = await querySystem<{ id: string }>(
    `insert into osirus.stripe_events (id, type) values ($1, $2)
     on conflict (id) do nothing returning id`,
    [id, type],
  );
  return rows.length > 0;
}

/** Undo a claim when processing failed, so Stripe's retry is processed. */
export async function releaseEvent(id: string) {
  await querySystem("delete from osirus.stripe_events where id = $1", [id]);
}

export async function userExists(userId: string) {
  const rows = await querySystem<{ id: string }>(
    "select id from osirus.users where id = $1",
    [userId],
  );
  return rows.length > 0;
}
