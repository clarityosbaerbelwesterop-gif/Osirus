import type { RunSnapshot } from "./types";

/**
 * What a status poll should do to keep its run moving.
 *
 * The poll is the only thing that drives a run between the request that
 * started it and the next scheduler tick, which may be hours away. So each
 * poll must be able to take every stuck state one step toward an end:
 *
 * - a stage nobody holds (pending, blocked, or running on an expired lease)
 *   is claimed again (`drive`);
 * - a run whose stages are all settled or dead is closed (`finalize`) --
 *   including the case where the claim itself failed the last stage and so
 *   claimed nothing;
 * - a cancellation with no live worker to acknowledge it is completed
 *   (`settleCancel`).
 *
 * A live lease means a worker is on it; the poll then does nothing.
 */
export type PollNudge = {
  settleCancel: boolean;
  drive: boolean;
  finalize: boolean;
};

const ACTIVE = new Set(["created", "planning", "queued", "running", "blocked"]);
const LIVE_ATTEMPT = new Set(["claimed", "running"]);
const DUE_SOON_MS = 3_000;
const NOTHING: PollNudge = {
  settleCancel: false,
  drive: false,
  finalize: false,
};

function time(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** True when some attempt of the run still holds an unexpired lease. */
export function hasLiveAttempt(
  attempts: RunSnapshot["attempts"],
  now = Date.now(),
) {
  return attempts.some((attempt) => {
    if (!LIVE_ATTEMPT.has(String(attempt.status))) return false;
    const expires = time(attempt.lease_expires_at);
    if (expires !== null) return expires > now;
    // No lease recorded: trust it only while it is young.
    const started = time(attempt.started_at);
    return started !== null && now - started < 10 * 60_000;
  });
}

export function pollNudge(snapshot: RunSnapshot, now = Date.now()): PollNudge {
  const status = snapshot.run.status;
  const live = hasLiveAttempt(snapshot.attempts, now);

  if (status === "cancelling") {
    return { ...NOTHING, settleCancel: !live };
  }
  if (!ACTIVE.has(status) || snapshot.run.cancelRequested) return NOTHING;
  if (live || snapshot.stages.length === 0) return NOTHING;

  const drive = snapshot.stages.some((stage) => {
    if (stage.status === "blocked") {
      // Parked for a retry: drive once it is (nearly) due, not every poll
      // before, or each poll would start a worker that only waits.
      const after = time(stage.runnable_after);
      return after === null || after - now <= DUE_SOON_MS;
    }
    return (
      stage.status === "pending" ||
      // Running with no live attempt: its worker died. The claim function
      // retires the lease and makes the stage claimable again.
      stage.status === "running"
    );
  });
  return { settleCancel: false, drive, finalize: true };
}
