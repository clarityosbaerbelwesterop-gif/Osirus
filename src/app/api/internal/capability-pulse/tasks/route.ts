import { z } from "zod";
import {
  listPulseRegistrations,
  parsePulseRegistration,
  registerPulseTask,
  unregisterPulseTask,
} from "@/lib/agent/pulse/registry";
import { preparePulseSuite } from "@/lib/agent/pulse/suite";
import { isOperator } from "@/lib/intelligence/production/operator";
import { guardAction, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Registration API for capability pulse tasks. Operators can list built-in
// and registered tasks and add descriptors M35–M44 resolve to runners later.

const registerSchema = z
  .object({
    id: z.string().min(1).max(120),
    lane: z.string().min(1).max(40),
    level: z.number().int().min(1).max(5),
    ref: z.string().min(1).max(120),
    title: z.string().min(1).max(200).optional(),
    objective: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const guard = await guardAction(request, {
    route: "capability-pulse.tasks",
    limit: 30,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  await preparePulseSuite();
  return json({ tasks: listPulseRegistrations() });
}

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema: registerSchema,
    route: "capability-pulse.tasks",
    limit: 20,
    maxBytes: 8 * 1024,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  const parsed = parsePulseRegistration(guard.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  registerPulseTask(parsed);
  await preparePulseSuite();
  return json({ task: parsed }, 201);
}

export async function DELETE(request: Request) {
  const guard = await guardAction(request, {
    route: "capability-pulse.tasks",
    limit: 20,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id_required" }, 400);
  unregisterPulseTask(id);
  return json({ removed: id });
}
