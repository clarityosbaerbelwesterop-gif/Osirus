import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { RuntimeRepository } from "@/lib/runtime/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  model: z.enum(["rouge", "quasnir", "darus"]),
  user: z.string().trim().min(1).max(8000),
  assistant: z.string().trim().min(1).max(16000),
});

// Saves a Chat thread. It does not read GitHub or any other connector.
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "chat.turns",
    limit: 30,
    maxBytes: 32_000,
  });
  if (!guard.ok) return guard.response;
  const repository = new RuntimeRepository(guard.identity.userId);
  let sessionId = guard.body.sessionId ?? null;
  if (sessionId) {
    const state = await repository
      .getSessionState(sessionId, guard.identity.workspaceId)
      .catch(() => null);
    if (!state || state.surface !== "ai") {
      return json(
        {
          error: "surface_mismatch",
          message: "That conversation belongs to another surface.",
        },
        409,
      );
    }
  } else {
    sessionId = await repository.createSession({
      organizationId: guard.identity.organizationId,
      workspaceId: guard.identity.workspaceId,
      title: guard.body.user.slice(0, 120),
      surface: "ai",
    });
  }
  await repository.createMessage({
    organizationId: guard.identity.organizationId,
    workspaceId: guard.identity.workspaceId,
    sessionId,
    role: "user",
    content: guard.body.user,
    metadata: { surface: "ai", model: guard.body.model },
  });
  await repository.createMessage({
    organizationId: guard.identity.organizationId,
    workspaceId: guard.identity.workspaceId,
    sessionId,
    role: "assistant",
    content: guard.body.assistant,
    metadata: {
      surface: "ai",
      model: guard.body.model,
      provenance: "api_fallback",
    },
  });
  return json({
    id: sessionId,
    title: guard.body.user.slice(0, 120),
    updatedAt: new Date().toISOString(),
    surface: "ai",
  });
}
