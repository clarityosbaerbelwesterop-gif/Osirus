import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { RuntimeRepository } from "@/lib/runtime/repository";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const paramsSchema = z.object({
  runId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

const ALLOWED_TYPES = new Set(["image/png"]);

/**
 * One screenshot from a run. The row is read under the caller's row-level
 * security, so a run that is not theirs answers exactly like one that does
 * not exist. Only PNG artifacts are served, never as a download or with a
 * type the browser could execute.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; artifactId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    await enforceRateLimit({
      subject: `user:${session.user.id}`,
      route: "runtime.artifact_image",
      limit: 120,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }

  const image = await new RuntimeRepository(session.user.id).getArtifactImage(
    params.data.runId,
    params.data.artifactId,
  );
  if (!image || !ALLOWED_TYPES.has(image.contentType))
    return Response.json({ error: "not_found" }, { status: 404 });

  const bytes = Buffer.from(image.data, "base64");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
