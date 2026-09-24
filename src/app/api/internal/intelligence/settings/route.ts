import { z } from "zod";
import { trainingProvider } from "@/lib/intelligence/models/training";
import { isOperator } from "@/lib/intelligence/production/operator";
import { PgIntelStore } from "@/lib/intelligence/store/pg-store";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Foundry switches and envelopes, for operators. Only the Intelligence
// Plane's own settings: nothing here reaches auth, RLS, secrets, billing or
// the database schema, and training cannot be switched on while no real
// training provider exists.
const schema = z
  .object({
    flags: z
      .object({
        intelligencePlane: z.boolean(),
        experiments: z.boolean(),
        curriculum: z.boolean(),
        selfPlay: z.boolean(),
        redIntelligence: z.boolean(),
        compilation: z.boolean(),
        strategyEvolution: z.boolean(),
        skillEvolution: z.boolean(),
        training: z.boolean(),
        autoCanary: z.boolean(),
        paidModelEmergency: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
    budgets: z
      .object({
        dailyModelCalls: z.number().int().min(0).max(20_000),
        dailyTokens: z.number().int().min(0).max(200_000_000),
        dailySandboxMinutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60),
        dailyChainedTicks: z.number().int().min(0).max(288),
        parallelTrials: z.number().int().min(1).max(4),
      })
      .partial()
      .strict()
      .optional(),
    clearProviderPause: z.literal(true).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "intelligence.settings",
    limit: 20,
    maxBytes: 4 * 1024,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  if (guard.body.flags?.training) {
    const capabilities = await trainingProvider().capabilities();
    if (!capabilities.available)
      return json({ error: "training_unavailable" }, 409);
  }
  const store = new PgIntelStore();
  const current = await store.settings();
  await store.saveSettings({
    ...current,
    flags: { ...current.flags, ...guard.body.flags },
    budgets: { ...current.budgets, ...guard.body.budgets },
    providerPause: guard.body.clearProviderPause ? null : current.providerPause,
  });
  return json({ settings: await store.settings() });
}
