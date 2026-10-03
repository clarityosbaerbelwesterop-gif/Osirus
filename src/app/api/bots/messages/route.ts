import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { RuntimeRepository } from "@/lib/runtime/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  sessionId: z.string().uuid(),
  content: z.string().trim().min(1).max(8000),
});

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "bots.messages",
    limit: 40,
    maxBytes: 12_000,
  });
  if (!guard.ok) return guard.response;
  const repository = new RuntimeRepository(guard.identity.userId);
  const state = await repository
    .getSessionState(guard.body.sessionId, guard.identity.workspaceId)
    .catch(() => null);
  if (!state || state.surface !== "bot") {
    return json(
      {
        error: "surface_mismatch",
        message: "That conversation belongs to another surface.",
      },
      409,
    );
  }
  const id = await repository.createMessage({
    organizationId: guard.identity.organizationId,
    workspaceId: guard.identity.workspaceId,
    sessionId: guard.body.sessionId,
    role: "user",
    content: guard.body.content,
    metadata: { surface: "bot" },
  });
  return json({ id, sessionId: guard.body.sessionId });
}
