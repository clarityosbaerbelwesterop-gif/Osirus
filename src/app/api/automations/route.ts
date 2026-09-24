import { z } from "zod";
import { createAutomation, listAutomations } from "@/lib/automations/store";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ automations: await listAutomations(identity) });
}

const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(8).max(4000),
    trigger: z.enum([
      "schedule",
      "run_completed",
      "connector_changed",
      "webhook",
    ]),
    webhook: z
      .object({
        endpointId: z.string().uuid().nullable().optional(),
        events: z
          .array(
            z.enum([
              "push",
              "pull_request",
              "ci_failure",
              "deployment",
              "db_event",
              "generic",
            ]),
          )
          .max(6)
          .optional(),
      })
      .nullable()
      .optional(),
    schedule: z
      .object({
        cadence: z.enum(["daily", "weekdays", "weekly"]),
        weekday: z.number().int().min(0).max(6).optional(),
      })
      .nullable()
      .optional(),
    policyPreset: z.enum(["cautious", "balanced"]),
    maxCostUsd: z.number().positive().max(100).nullable().optional(),
    maxTokens: z.number().int().positive().max(5_000_000).nullable().optional(),
    allowedTools: z
      .array(z.string().regex(/^[a-z_.:/-]{3,120}$/))
      .max(40)
      .optional(),
    notifyOn: z
      .array(z.enum(["completed", "failed", "approval"]))
      .max(3)
      .optional(),
  })
  .refine((value) => value.trigger !== "schedule" || value.schedule, {
    message: "schedule_required",
  });

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "automations.create",
    limit: 20,
    maxBytes: 16 * 1024,
  });
  if (!guard.ok) return guard.response;
  try {
    const automation = await createAutomation(guard.identity, guard.body);
    return json({ automation }, 201);
  } catch {
    return json({ error: "forbidden" }, 403);
  }
}
