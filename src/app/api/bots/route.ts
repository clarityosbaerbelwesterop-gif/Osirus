import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { RuntimeRepository } from "@/lib/runtime/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

const note =
  "This bot keeps its own thread. There is no bot runtime in this build, so messages are saved here and are not sent to a model.";

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
  await repository.createMessage({
    organizationId: guard.identity.organizationId,
    workspaceId: guard.identity.workspaceId,
    sessionId: id,
    role: "assistant",
    content: note,
    metadata: { surface: "bot", honest: true },
  });
  return json({
    id,
    title: guard.body.title,
    updatedAt: new Date().toISOString(),
    surface: "bot",
    note,
  });
}
