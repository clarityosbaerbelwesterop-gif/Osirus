import { z } from "zod";
import {
  deleteAutomation,
  setAutomationEnabled,
} from "@/lib/automations/store";
import { guardAction, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const params = z.object({ automationId: z.string().uuid() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardWrite(request, {
    schema: z.object({ enabled: z.boolean() }),
    route: "automations.update",
    limit: 60,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  const automation = await setAutomationEnabled(
    guard.identity,
    parsed.data.automationId,
    guard.body.enabled,
  );
  return automation ? json({ automation }) : json({ error: "not_found" }, 404);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardAction(request, {
    route: "automations.delete",
    limit: 20,
  });
  if (!guard.ok) return guard.response;
  const removed = await deleteAutomation(
    guard.identity,
    parsed.data.automationId,
  );
  return removed ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
