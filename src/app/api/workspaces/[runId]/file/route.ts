import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { DbWorkspaceStore } from "@/lib/coding/db-store";
import { CodingWorkspace } from "@/lib/coding/workspace";
import { resolveSandbox } from "@/lib/sandbox";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const paramsSchema = z.object({ runId: z.string().uuid() });
const querySchema = z.object({ path: z.string().min(1).max(400) });

/**
 * One file from the live workspace. The record is loaded under the caller's
 * row-level security first, so the sandbox handle used to reattach is only
 * ever one the caller's run owns. The path goes through the same realpath
 * containment as the agent's own reads.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await context.params);
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!params.success || !query.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    await enforceRateLimit({
      subject: `user:${session.user.id}`,
      route: "workspaces.file",
      limit: 60,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }

  const record = await new DbWorkspaceStore(session.user.id).load(
    params.data.runId,
  );
  if (!record) return Response.json({ error: "not_found" }, { status: 404 });
  if (record.status === "destroyed")
    return Response.json({ error: "workspace_destroyed" }, { status: 410 });

  const driver = await resolveSandbox();
  if (!driver.availability().configured || !driver.reattach)
    return Response.json({ error: "sandbox_not_configured" }, { status: 503 });
  const handle = await driver.reattach(record.handle);
  if (!handle)
    return Response.json({ error: "workspace_gone" }, { status: 410 });
  try {
    const content = await new CodingWorkspace(handle).read(
      query.data.path,
      400_000,
    );
    return Response.json({ path: query.data.path, content });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "read_failed";
    const status = /outside|escapes/.test(reason) ? 400 : 404;
    return Response.json({ error: reason.slice(0, 80) }, { status });
  }
}
