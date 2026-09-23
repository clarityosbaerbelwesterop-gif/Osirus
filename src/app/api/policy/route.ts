import { z } from "zod";
import { ACTION_CLASSES } from "@/lib/policy/model";
import { loadWorkspacePolicy, saveWorkspacePolicy } from "@/lib/policy/store";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json(await loadWorkspacePolicy(identity));
}

const decision = z.enum(["allow", "ask", "deny"]);
const schema = z.object({
  preset: z.enum(["cautious", "balanced", "autonomous", "custom"]),
  decisions: z
    .object(
      Object.fromEntries(
        ACTION_CLASSES.map((cls) => [cls, decision.optional()]),
      ),
    )
    .optional(),
});

/** Save the workspace policy. Floors are applied on save, whatever is sent. */
export async function PUT(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "policy.save",
    limit: 30,
    maxBytes: 4096,
  });
  if (!guard.ok) return guard.response;
  try {
    const policy = await saveWorkspacePolicy(guard.identity, {
      preset: guard.body.preset,
      decisions: guard.body.decisions as never,
    });
    return json(policy);
  } catch {
    // RLS: only workspace owners and editors may change the policy.
    return json({ error: "forbidden" }, 403);
  }
}
