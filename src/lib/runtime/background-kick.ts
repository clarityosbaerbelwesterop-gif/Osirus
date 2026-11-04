import "server-only";
import { needsBackground } from "./background";

/**
 * After the request that drove a run ends: when the run still has claimable
 * work, ask for a scheduler tick now instead of waiting for the next one.
 * Production only (the tick URL exists there); never throws.
 */
export async function continueInBackground(input: {
  userId: string;
  runId: string;
}) {
  try {
    const { RuntimeRepository } = await import("./repository");
    const run = await new RuntimeRepository(input.userId).getRun(input.runId);
    if (!run || !needsBackground(String(run.status))) return false;
    const { triggerTick } = await import("../intelligence/production/operator");
    return await triggerTick(0);
  } catch {
    return false;
  }
}
