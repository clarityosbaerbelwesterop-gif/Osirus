import { after } from "next/server";
import {
  isOperator,
  productionTickUrl,
  triggerTick,
} from "@/lib/intelligence/production/operator";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Run now" in the Intelligence Lab: asks the scheduler for a tick at once.
// Operators only; anyone else is told the route does not exist.
export async function POST(request: Request) {
  const guard = await guardAction(request, {
    route: "intelligence.run",
    limit: 6,
  });
  if (!guard.ok) return guard.response;
  if (!(await isOperator(guard.identity.userId)))
    return json({ error: "not_found" }, 404);
  if (!productionTickUrl()) return json({ error: "production_only" }, 409);
  after(() => triggerTick(0).then(() => undefined));
  return json({ started: true }, 202);
}
