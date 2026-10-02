import { join } from "node:path";
import { loadProductSession } from "@/lib/product/session";
import { programInBuild } from "../../../../../ai-lab/programs/catalog";
import { answerWithProgram } from "../../../../../ai-lab/programs/serve";
import { nativeAvailabilityForTrack } from "../../../../../ai-lab/tracks/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await loadProductSession();
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
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
      provenance: answer.provenance,
      provider: answer.provider,
      modelId: answer.modelId,
      checkpoint: answer.checkpoint,
      version: answer.version,
      routingReason: answer.routingReason,
      latencyMs: answer.latencyMs,
      costUsd: answer.costUsd,
      activity: answer.activity,
      trained: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fallback failed";
    if (message.includes("UNOROUTER_API_KEY")) {
      return Response.json(
        { error: "fallback_unavailable", message },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: "fallback_failed",
        message: "The fallback provider did not return a completion.",
      },
      { status: 502 },
    );
  }
}
