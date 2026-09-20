import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { executeRuntimeRun, prepareRuntimeRun } from "@/lib/runtime/executor";
import { routeCapabilities } from "@/lib/runtime/router";
import { encodeSse } from "@/lib/runtime/sse";
import type { RuntimePacket } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({
  objective: z.string().trim().min(1).max(100_000),
  requestId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const capabilities = routeCapabilities(parsed.data.objective);
  const prepared = await prepareRuntimeRun({
    identity,
    objective: parsed.data.objective,
    requestId: parsed.data.requestId,
    capabilities,
    sessionId: parsed.data.sessionId,
  });

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
              message:
                error instanceof Error ? error.message : "Reconnect failed",
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
      })
        .catch((error: unknown) => {
          emit({
            kind: "error",
            runId: prepared.runId,
            message:
              error instanceof Error
                ? error.message
                : "Runtime execution failed",
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
    },
  });
}
