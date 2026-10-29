import { createHash } from "node:crypto";
import { OPERATOR } from "@/app/legal/operator";
import { absoluteUrl } from "@/app/site-url";
import { processCancellation } from "@/lib/cancellation/process";
import {
  cancellationSchema,
  requestedEndValid,
} from "@/lib/cancellation/rules";
import { cancellationDeps } from "@/lib/cancellation/store";
import { json } from "@/lib/product/api";
import { loadAuthUser } from "@/lib/product/session";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The cancellation page posts here (§ 312k BGB). No sign-in is required:
// the law forbids making a cancellation depend on one. A signed-in person is
// matched to their account directly; otherwise the address decides.

function networkHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const ip = forwarded?.trim() || request.headers.get("x-real-ip")?.trim();
  return ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null;
}

/** False only when a limit is reached; a store outage never blocks a cancellation. */
async function allowed(subject: string, route: string, limit: number) {
  try {
    await enforceRateLimit({ subject, route, limit });
    return true;
  } catch (error) {
    return !(error instanceof RateLimitError);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return json({ error: "unsupported_media_type" }, 415);
  const raw = await readJsonBody(request, 16 * 1024);
  if (!raw.ok)
    return json(
      { error: raw.error },
      raw.error === "payload_too_large" ? 413 : 400,
    );
  const parsed = cancellationSchema.safeParse(raw.value);
  if (!parsed.success)
    return json(
      {
        error: "invalid_request",
        fields: [
          ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
        ],
      },
      400,
    );
  const declaration = parsed.data;
  if (!requestedEndValid(declaration.requestedEnd, new Date()))
    return json({ error: "invalid_request", fields: ["requestedEnd"] }, 400);

  const network = networkHash(request);
  if (
    !(await allowed(
      `cancel:ip:${network ?? "unknown"}`,
      "cancellation.ip",
      10,
    )) ||
    !(await allowed(`cancel:${declaration.email}`, "cancellation.email", 5))
  )
    return json({ error: "rate_limited" }, 429);

  const user = await loadAuthUser().catch(() => null);
  try {
    const receipt = await processCancellation(
      declaration,
      {
        signedInUserId: user?.id ?? null,
        signedInEmail: user?.email ?? null,
        networkHash: network,
      },
      cancellationDeps({
        operator: OPERATOR,
        pageUrl: absoluteUrl("/kuendigen"),
      }),
    );
    return json(receipt, 201);
  } catch (error) {
    console.error("cancellation: not stored", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "not_stored" }, 503);
  }
}
