import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { AccountDeletionBlocked, deleteAccount } from "@/lib/privacy/account";
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
      },
    );
  } catch (error) {
    if (error instanceof AccountDeletionBlocked)
      return json({ error: error.code, message: error.message }, 409);
    console.error("account.delete failed", error instanceof Error ? error.message : "unknown");
    return json(
      {
        error: "delete_failed",
        message:
          "Das Konto konnte nicht gelöscht werden. Bitte schreib uns, wir löschen es dann von Hand.",
      },
      500,
    );
  }
  return json({ deleted: true }, 200);
}
