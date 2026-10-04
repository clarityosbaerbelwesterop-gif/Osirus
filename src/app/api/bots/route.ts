import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { RuntimeRepository } from "@/lib/runtime/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

// Creates an empty bot thread. The reply is produced by the shared runtime
// when the person sends a message. This route does not invent one.
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema: createSchema,
    route: "bots.create",
    limit: 20,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  const repository = new RuntimeRepository(guard.identity.userId);
  const id = await repository.createSession({
    organizationId: guard.identity.organizationId,
    workspaceId: guard.identity.workspaceId,
    title: guard.body.title,
    surface: "bot",
  });
  return json({
    id,
    title: guard.body.title,
    updatedAt: new Date().toISOString(),
    surface: "bot",
  });
}
