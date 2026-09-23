import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { runAutomationNow } from "@/lib/automations/store";
import { guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const params = z.object({ automationId: z.string().uuid() });

/**
 * Start an automation now. The run is created and planned in the request;
 * its stages then execute in the background after the response is sent,
 * within this function's time limit. Anything left over resumes when the
 * conversation is opened or at the next scheduler window.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_id" }, 400);
  const guard = await guardAction(request, {
    route: "automations.run",
    limit: 10,
  });
  if (!guard.ok) return guard.response;
  const started = await runAutomationNow(
    guard.identity,
    parsed.data.automationId,
  );
  if (!started) return json({ error: "not_found" }, 404);
  after(async () => {
    const { driveSlices, finalizeRun } = await import("@/lib/runtime/worker");
    const controller = new AbortController();
    const deadlineAt = Date.now() + 240_000;
    const timer = setTimeout(
      () => controller.abort(new Error("background_budget")),
      240_000,
    );
    try {
      const slice = await driveSlices({
        runId: started.runId,
        workerId: `automation:${randomUUID()}`,
        deadlineAt,
        signal: controller.signal,
        identity: started.identity,
      });
      await finalizeRun({
        identity: started.identity,
        runId: started.runId,
        exhausted: slice.exhausted,
      });
    } catch {
      // The run stays resumable; nothing to report from the background.
    } finally {
      clearTimeout(timer);
    }
  });
  return json({ runId: started.runId, sessionId: started.sessionId }, 202);
}
