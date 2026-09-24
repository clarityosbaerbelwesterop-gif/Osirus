import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { resolveMemoryConflict } from "@/lib/product/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  winningMemoryId: z.string().uuid(),
  rejectedMemoryIds: z.array(z.string().uuid()).max(20),
});

/** Resolve a suspected memory contradiction by keeping one canonical value. */
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema: bodySchema,
    route: "memory.conflicts.resolve",
    limit: 30,
  });
  if (!guard.ok) return guard.response;
  await resolveMemoryConflict(guard.identity, guard.body);
  return json({ ok: true });
}
