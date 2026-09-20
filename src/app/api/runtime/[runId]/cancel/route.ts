import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { abortLocalRun } from "@/lib/runtime/cancellation";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { hasSameOrigin } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ runId: z.string().uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }

  const repository = new RuntimeRepository(session.user.id);
  const run = await repository.requestCancellation(parsed.data.runId);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });

  abortLocalRun(parsed.data.runId);
  return Response.json({ runId: parsed.data.runId, status: run.status });
}
