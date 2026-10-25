import { join } from "node:path";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { loadProductSession } from "@/lib/product/session";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";
import { labKeyPool } from "../../../../../ai-lab/inference/key-pool";
import { redactSecrets } from "../../../../../ai-lab/observability/log";
import { programInBuild } from "../../../../../ai-lab/programs/catalog";
import { answerWithProgram } from "../../../../../ai-lab/programs/serve";
import { nativeAvailabilityForTrack } from "../../../../../ai-lab/tracks/status";

function clientError(error: unknown): {
  status: number;
  error: string;
  message: string;
} {
  const raw = error instanceof Error ? error.message : "fallback failed";
  const redacted = String(redactSecrets(raw, labKeyPool(process.env)));
  if (redacted.includes("UNOROUTER_API_KEY")) {
    return { status: 503, error: "fallback_unavailable", message: redacted };
  }
  if (
    redacted.startsWith("cost budget stop") ||
    redacted.startsWith("no price")
  ) {
    return { status: 503, error: "budget_stop", message: redacted };
  }
  return {
    status: 502,
    error: "fallback_failed",
    message: "The fallback provider did not return a completion.",
  };
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await loadProductSession();
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  try {
    await enforceRateLimit({
      subject: `user:${session.identity.userId}`,
      route: "lab.complete",
      limit: 20,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }
  if (quotaEnforced()) {
    const quota = await quotaStatusFor(session.identity.userId);
    if (!quota.allowed) {
      const noPlan = quota.reason === "no_subscription";
      return Response.json(
        {
          error: noPlan ? "subscription_required" : "quota_exhausted",
          message: publicRuntimeErrorMessage({
            code: noPlan ? "subscription_required" : "quota_exhausted",
          }),
          quota: serializeQuota(quota),
        },
        {
          status: noPlan ? 402 : 429,
          headers: noPlan
            ? undefined
            : { "Retry-After": String(Math.ceil(quota.retryAfterMs / 1000)) },
        },
      );
    }
  }
  const parsedBody = await readJsonBody(request, 256_000);
  const body = (parsedBody.ok ? parsedBody.value : null) as {
    modelId?: unknown;
    interaction?: unknown;
    messages?: unknown;
  } | null;
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  const interaction =
    body?.interaction === "ai" || body?.interaction === "agent"
      ? body.interaction
      : null;
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!modelId || !interaction || !messages) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (interaction !== "ai") {
    return Response.json(
      {
        error: "agent_mode_uses_osirus",
        message:
          "Agent mode is Osirus orchestrating. This endpoint only answers in AI mode.",
      },
      { status: 400 },
    );
  }
  if (modelId === "external") {
    return Response.json(
      {
        error: "external_api_is_not_a_lab_model",
        message:
          "External API is the existing Osirus provider pool, not ROUGE 1, QUASNIR, or DARUS.",
      },
      { status: 400 },
    );
  }
  const program = programInBuild(modelId);
  if (!program) {
    return Response.json(
      {
        error: "not_in_this_build",
        message: `${modelId} is not included in this build. No response was invented.`,
      },
      { status: 409 },
    );
  }
  const safeMessages = messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const row = message as { role?: unknown; content?: unknown };
    if (
      (row.role !== "user" &&
        row.role !== "assistant" &&
        row.role !== "system") ||
      typeof row.content !== "string"
    ) {
      return [];
    }
    const role: "user" | "assistant" | "system" = row.role;
    return [{ role, content: row.content.slice(0, 8000) }];
  });
  if (!safeMessages.length)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const native = nativeAvailabilityForTrack(
      join(process.cwd(), "ai-lab/var/native"),
      program.id,
      process.env,
    );
    const answer = await answerWithProgram({
      program,
      native,
      messages: safeMessages,
    });
    return Response.json({
      text: answer.text,
      userLabel: answer.userLabel,
      activity: answer.activity,
      phases: answer.phases,
      armIds: answer.armIds,
      fixtureChecks: answer.fixtureChecks,
      measuredEqual: false,
      outsideProgram: answer.outsideProgram,
      completion: answer.completion,
      trained: false,
    });
  } catch (error) {
    const body = clientError(error);
    return Response.json(
      { error: body.error, message: body.message },
      { status: body.status },
    );
  }
}
