/**
 * A poll snapshot may be applied only if the view has not moved on.
 * Late responses from a previous conversation must not replace the one
 * on screen. This is the client race that showed another run's steps.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function shouldApplyRunSnapshot(input: {
  capturedGeneration: number;
  generation: number;
  requestedRunId: string;
  snapshotRunId: string;
  snapshotSessionId: string;
  viewSessionId: string | null;
}): boolean {
  if (input.capturedGeneration !== input.generation) return false;
  if (input.snapshotRunId !== input.requestedRunId) return false;
  if (!isSessionId(input.snapshotSessionId)) return false;
  if (
    input.viewSessionId !== null &&
    input.snapshotSessionId !== input.viewSessionId
  ) {
    return false;
  }
  return true;
}
