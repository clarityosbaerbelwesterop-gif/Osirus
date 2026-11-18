import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { guardWrite, json } from "@/lib/product/api";
import {
  AccountDeletionBlocked,
  deleteAccount,
  recentlySignedIn,
  LIVE_SUBSCRIPTION_STATUSES,
} from "@/lib/privacy/account";
import { customerIdFor } from "@/lib/billing/store";
import { billingConfigured, stripe } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Art. 17 DSGVO: the person deletes their account. The typed confirmation
// guards against a stray click; a running paid plan ends only when the
// person confirmed that too.

const schema = z.object({
  confirm: z.literal("LÖSCHEN"),
  endSubscription: z.boolean().optional().default(false),
});

export async function DELETE(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "account.delete",
    limit: 3,
    maxBytes: 1_000,
  });
  if (!guard.ok) return guard.response;
  // A stolen or forgotten session must not be enough to erase everything:
  // deleting needs a sign-in from the last 15 minutes.
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  const createdAt = (
    session as { session?: { createdAt?: Date | string } } | null
  )?.session?.createdAt;
  if (!recentlySignedIn(createdAt))
    return json(
      {
        error: "reauth_required",
        message:
          "Melde dich zur Sicherheit neu an und lösche dein Konto danach innerhalb von 15 Minuten.",
      },
      403,
    );
  // Bots' cloud computers are deleted with the account (Art. 17): their
  // names derive from the bots, so they are listed before the rows go.
  const { listAgents } = await import("@/lib/agents/store");
  const botIds = await listAgents(guard.identity)
    .then((bots) => bots.map((bot) => bot.id))
    .catch(() => [] as string[]);
  try {
    await deleteAccount(
      guard.identity,
      { endSubscription: guard.body.endSubscription },
      {
        cancelSubscription: billingConfigured()
          ? async (id) => {
              await stripe().subscriptions.cancel(id, {
                invoice_now: false,
                prorate: false,
              });
            }
          : undefined,
        // Stripe, not the database: a checkout finished moments ago, or a
        // second subscription, is only known there.
        liveSubscriptions: billingConfigured()
          ? async () => {
              const customer = await customerIdFor(guard.identity.userId);
              if (!customer) return [];
              const { data } = await stripe().subscriptions.list({
                customer,
                status: "all",
                limit: 100,
              });
              return data
                .filter((row) => LIVE_SUBSCRIPTION_STATUSES.has(row.status))
                .map((row) => row.id);
            }
          : undefined,
        deleteCustomer: billingConfigured()
          ? async () => {
              const customer = await customerIdFor(guard.identity.userId);
              if (!customer) return;
              await stripe()
                .customers.del(customer)
                .catch((error: unknown) => {
                  // Already gone at Stripe: nothing left to delete.
                  if ((error as { code?: string })?.code === "resource_missing")
                    return;
                  throw error;
                });
            }
          : undefined,
      },
    );
  } catch (error) {
    if (error instanceof AccountDeletionBlocked)
      return json({ error: error.code, message: error.message }, 409);
    console.error(
      "account.delete failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      {
        error: "delete_failed",
        message:
          "Das Konto konnte nicht gelöscht werden. Bitte schreib uns, wir löschen es dann von Hand.",
      },
      500,
    );
  }
  // The sign-in is gone; end this browser's session now instead of when its
  // cached session cookie expires.
  await auth.signOut().catch(() => undefined);
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (/neon-auth|better-auth/i.test(cookie.name))
      store.delete({ name: cookie.name, path: "/", secure: true });
  }
  if (botIds.length) {
    const { resolveSandbox } = await import("@/lib/sandbox");
    const driver = await resolveSandbox();
    const workspaceId = guard.identity.workspaceId;
    const removeComputers = async () => {
      const { deleteComputers } = await import("@/lib/agents/bot-computer");
      await deleteComputers(driver, workspaceId, botIds).catch(() => undefined);
    };
    try {
      after(removeComputers);
    } catch {
      // Outside a request scope (scripts, tests): run it right away.
      void removeComputers();
    }
  }
  return json({ deleted: true }, 200);
}
