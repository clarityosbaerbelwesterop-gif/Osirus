import "server-only";
import { currentSubscription } from "../billing/store";
import { billingConfigured, stripe } from "../billing/stripe";
import { querySystem } from "../db/client";
import { ownerEmailList } from "../gateway/owners";
import { sendMail } from "../mail/send";
import { notify } from "../product/notifications";
import type { CancellationDeps } from "./process";
import { cancellationReference, type Operator } from "./rules";

// The real dependencies of processCancellation: the declarations table, the
// account lookup, Stripe, Resend and the operator's inbox.

async function operatorRecipients(operator: Operator) {
  const emails = [
    ...new Set([operator.email.toLowerCase(), ...ownerEmailList()]),
  ];
  return querySystem<{
    user_id: string;
    organization_id: string;
    workspace_id: string;
  }>(
    `select distinct on (u.id) u.id as user_id, wm.organization_id, wm.workspace_id
       from osirus.users u
       join osirus.workspace_memberships wm on wm.user_id = u.id
      where lower(u.email) = any($1::text[])
      order by u.id, wm.created_at asc`,
    [emails],
  );
}

export function cancellationDeps(site: {
  operator: Operator;
  pageUrl: string;
}): CancellationDeps {
  return {
    reference: () => cancellationReference(new Date()),
    async insert(row) {
      const d = row.declaration;
      const rows = await querySystem<{ received_at: string | Date }>(
        `insert into osirus.contract_cancellations
           (reference, name, email, contract, customer_reference, kind, reason,
            timing, requested_end, signed_in, network_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11)
         returning received_at`,
        [
          row.reference,
          d.name,
          d.email,
          d.contract,
          d.customerReference ?? null,
          d.kind,
          d.reason ?? null,
          d.timing,
          d.requestedEnd ?? null,
          row.signedIn,
          row.networkHash,
        ],
      );
      return { receivedAt: new Date(rows[0]!.received_at) };
    },
    async update(reference, patch) {
      const sets: string[] = [];
      const values: unknown[] = [reference];
      const set = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      // Only an existing account row is linked (the foreign key would
      // otherwise reject the whole update).
      if (patch.userId !== undefined) {
        values.push(patch.userId);
        sets.push(
          `user_id = (select id from osirus.users where id = $${values.length}::uuid)`,
        );
      }
      if (patch.subscriptionId !== undefined)
        set("stripe_subscription_id", patch.subscriptionId);
      if (patch.status !== undefined) set("status", patch.status);
      if (patch.effectiveAt !== undefined)
        set("effective_at", patch.effectiveAt?.toISOString() ?? null);
      if (patch.note !== undefined) set("processing_note", patch.note);
      if (patch.confirmationSentAt !== undefined)
        set("confirmation_sent_at", patch.confirmationSentAt.toISOString());
      if (!sets.length) return;
      await querySystem(
        `update osirus.contract_cancellations
            set ${sets.join(", ")}, updated_at = now()
          where reference = $1`,
        values,
      );
    },
    async userIdForEmail(email) {
      const rows = await querySystem<{ id: string }>(
        "select id from osirus.users where lower(email) = lower($1) limit 1",
        [email],
      );
      if (rows[0]) return rows[0].id;
      // A subscription may have been paid with another billing address.
      if (!billingConfigured()) return null;
      const customers = await stripe().customers.list({ email, limit: 3 });
      for (const customer of customers.data) {
        const owner = await querySystem<{ user_id: string }>(
          "select user_id from osirus.billing_customers where stripe_customer_id = $1",
          [customer.id],
        );
        if (owner[0]) return owner[0].user_id;
      }
      return null;
    },
    async accountEmail(userId) {
      const rows = await querySystem<{ email: string | null }>(
        "select email from osirus.users where id = $1::uuid",
        [userId],
      );
      return rows[0]?.email ?? null;
    },
    async subscriptionFor(userId) {
      const row = await currentSubscription(userId);
      if (!row) return null;
      return {
        id: row.stripe_subscription_id,
        status: row.status,
        periodEnd: row.current_period_end
          ? new Date(row.current_period_end)
          : null,
        cancelAtPeriodEnd: row.cancel_at_period_end,
      };
    },
    async applyPlan(subscriptionId, plan) {
      if (!billingConfigured()) throw new Error("billing_not_configured");
      const updated = await stripe().subscriptions.update(
        subscriptionId,
        plan.action === "at"
          ? {
              cancel_at: Math.floor(plan.at.getTime() / 1000),
              metadata: { osirus_cancellation: "kuendigen" },
            }
          : {
              cancel_at_period_end: true,
              metadata: { osirus_cancellation: "kuendigen" },
            },
      );
      const end =
        updated.cancel_at ??
        (updated.cancel_at_period_end
          ? updated.items.data[0]?.current_period_end
          : null);
      return { effectiveAt: end ? new Date(end * 1000) : null };
    },
    sendMail,
    async notifyOperator(input) {
      for (const recipient of await operatorRecipients(site.operator)) {
        await notify(
          {
            userId: recipient.user_id,
            organizationId: recipient.organization_id,
            workspaceId: recipient.workspace_id,
          },
          {
            kind: "cancellation_received",
            title: input.title,
            body: input.body,
            dedupeKey: `cancellation:${input.reference}`,
          },
        );
      }
    },
    operator: site.operator,
    pageUrl: site.pageUrl,
    log: (message, data) => console.warn(message, data ?? {}),
  };
}
