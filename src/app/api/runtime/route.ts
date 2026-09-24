import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { executeRuntimeRun, prepareRuntimeRun } from "@/lib/runtime/executor";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";
import { routeCapabilities } from "@/lib/runtime/router";
import { encodeSse } from "@/lib/runtime/sse";
import type { RuntimePacket } from "@/lib/runtime/types";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({
  objective: z.string().trim().min(1).max(100_000),
  requestId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  regenerate: z.boolean().optional().default(false),
  attachmentIds: z.array(z.string().uuid()).max(8).optional(),
});

export async function POST(request: Request) {
  const suppliedCorrelationId = request.headers.get("x-request-id");
  const correlationId =
    z.string().uuid().safeParse(suppliedCorrelationId).data ??
    crypto.randomUUID();
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return Response.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }

  const parsed = inputSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "runtime.create",
      limit: 12,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    if (error instanceof RateLimitUnavailableError) {
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    }
    throw error;
  }
  const capabilities = routeCapabilities(parsed.data.objective);
  let prepared;
  try {
    prepared = await prepareRuntimeRun({
      identity,
      objective: parsed.data.objective,
      requestId: parsed.data.requestId,
      capabilities,
      sessionId: parsed.data.sessionId,
      regenerate: parsed.data.regenerate,
    });
  } catch (error) {
    return Response.json(
      { error: publicRuntimeErrorMessage(error) },
      { status: 400 },
    );
  }

  // Files sent with this message: bound to its session, read by the run
  // through retrieval. Ids outside the caller's workspace simply do not
  // resolve (RLS), so they are dropped rather than trusted.
  let attachments: Array<{ id: string; kind: string }> = [];
  if (parsed.data.attachmentIds?.length && prepared.created) {
    const { bindAttachments, listAttachments } =
      await import("@/lib/attachments/store");
    await bindAttachments(
      identity,
      parsed.data.attachmentIds,
      prepared.sessionId,
    ).catch(() => undefined);
    attachments = (
      await listAttachments(identity, {
        ids: parsed.data.attachmentIds,
      }).catch(() => [])
    ).map((attachment) => ({ id: attachment.id, kind: attachment.kind }));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (packet: RuntimePacket) => {
        controller.enqueue(encoder.encode(encodeSse(packet)));
      };

      if (!prepared.created) {
        void import("@/lib/runtime/repository")
          .then(async ({ RuntimeRepository }) => {
            const repository = new RuntimeRepository(identity.userId);
            const snapshot = await repository.getSnapshot(prepared.runId);
            emit({ kind: "snapshot", snapshot });
            emit({
              kind: "done",
              runId: prepared.runId,
              status: snapshot.run.status,
            });
          })
          .catch((error: unknown) => {
            emit({
              kind: "error",
              runId: prepared.runId,
              message: publicRuntimeErrorMessage(error),
            });
          })
          .finally(() => controller.close());
        return;
      }

      void executeRuntimeRun({
        identity,
        runId: prepared.runId,
        sessionId: prepared.sessionId,
        objective: parsed.data.objective,
        capabilities,
        emit,
        correlationId,
        attachments,
      })
        .catch((error: unknown) => {
          emit({
            kind: "error",
            runId: prepared.runId,
            message: publicRuntimeErrorMessage(error),
          });
        })
        .finally(() => controller.close());
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Osirus-Run-Id": prepared.runId,
      "X-Osirus-Session-Id": prepared.sessionId,
      "X-Request-Id": correlationId,
    },
  });
}
