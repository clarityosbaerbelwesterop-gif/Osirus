import "server-only";
import { querySystem } from "../db/client";
import { RuntimeRepository } from "./repository";
import { finalizeRun } from "./worker";

// Recovery for runs nothing will ever touch again: the process that planned
// them died mid-plan, the worker that settled their last stage died before
// closing the run, or a stage failed with no worker left to close the run. Expired stage leases are already reclaimed by
// claim_next_stage; this closes what that cannot see. Run by the scheduler
// tick, as the run's own requester.

const STALE_MINUTES = 30;

type Stuck = {
  id: string;
  requested_by: string;
  organization_id: string;
  workspace_id: string;
  status: string;
  total: string;
  settled: string;
};

export async function recoverStuckRuns(limit = 10) {
  const rows = await querySystem<Stuck>(
    `select r.id, r.requested_by, r.organization_id, r.workspace_id, r.status,
            count(s.id) as total,
            count(s.id) filter (where s.status in ('completed', 'skipped')) as settled
       from osirus.runs r
       left join osirus.run_stages s on s.run_id = r.id
      where r.status in ('created', 'planning', 'queued', 'running')
        and r.updated_at < now() - make_interval(mins => $1)
      group by r.id
     having (r.status in ('created', 'planning') and count(s.id) = 0)
         or (count(s.id) > 0
             and count(s.id) = count(s.id) filter (where s.status in ('completed', 'skipped')))
         -- A failed stage is never claimed again. When the claim that failed
         -- it came from the scheduler (no run in scope), nobody finalizes.
         or (count(s.id) filter (where s.status = 'failed') > 0
             and count(s.id) filter (where s.status = 'running') = 0)
      order by r.updated_at
      limit $2`,
    [STALE_MINUTES, limit],
  );
  const recovered: Array<{ runId: string; action: string }> = [];
  for (const row of rows) {
    const identity = {
      userId: row.requested_by,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
    };
    try {
      if (Number(row.total) === 0) {
        await new RuntimeRepository(identity.userId).transitionRun(
          row.id,
          "failed",
          {
            errorCode: "planning_interrupted",
            errorMessage:
              "Planning stopped before the run had any steps; start it again.",
          },
        );
        recovered.push({ runId: row.id, action: "failed_unplanned" });
      } else {
        // A queued run whose stages all settled never saw a worker start
        // it; start it so it can be closed.
        if (row.status === "queued")
          await new RuntimeRepository(identity.userId).startIfQueued(row.id);
        const completion = await finalizeRun({ identity, runId: row.id });
        recovered.push({
          runId: row.id,
          action: `finalized_${completion.status}`,
        });
      }
    } catch {
      // Left for the next tick; one bad row never blocks the others.
    }
  }
  return recovered;
}

// Runs that wait on a person who will not come.
//
// Live 2026-11-16: three runs sat in "waiting_for_approval" for days (two
// since 2026-10-04). Their only approval had expired after its hour, so
// nobody could decide it; the stage is released only when someone opens the
// run, and then it works again and files the next request. A paused run
// keeps its workspace snapshot for seven days and cannot resume after that.
// Both are closed here, with the reason on the run, so the person sees
// "abgebrochen, Freigabe abgelaufen" instead of a task that waits forever.

const APPROVAL_ABANDONED_HOURS = 24;
const PAUSE_ABANDONED_DAYS = 7;

type Abandoned = { id: string; requested_by: string; reason: string };

export async function closeAbandonedWaits(limit = 10) {
  const rows = await querySystem<Abandoned>(
    `select r.id, r.requested_by,
            case when r.paused_at is not null then 'pause' else 'approval' end as reason
       from osirus.runs r
      where r.status not in ('completed', 'failed', 'cancelled')
        and (
          (
            r.status = 'waiting_for_approval'
            and r.paused_at is null
            and r.updated_at < now() - make_interval(hours => $1)
            -- An approval existed and its window closed ...
            and exists (
              select 1 from osirus.approvals a
               where a.run_id = r.id
                 and a.status in ('requested', 'expired')
                 and a.expires_at is not null and a.expires_at <= now()
            )
            -- ... nothing is left that a person could still decide ...
            and not exists (
              select 1 from osirus.approvals a
               where a.run_id = r.id
                 and a.status = 'requested'
                 and (a.expires_at is null or a.expires_at > now())
            )
            -- ... and the run does not wait on an answer to a question.
            and not exists (
              select 1 from osirus.run_stages s
               where s.run_id = r.id
                 and s.status = 'waiting'
                 and s.output->>'waitingOn' = 'human'
            )
          )
          or r.paused_at < now() - make_interval(days => $2)
        )
      order by r.updated_at
      limit $3`,
    [APPROVAL_ABANDONED_HOURS, PAUSE_ABANDONED_DAYS, limit],
  );
  const closed: Array<{ runId: string; reason: string }> = [];
  for (const row of rows) {
    const repository = new RuntimeRepository(row.requested_by);
    try {
      await repository.expireOpenApprovals(row.id);
      await repository
        .appendEvent({
          runId: row.id,
          type: "run.abandoned",
          visibility: "user",
          summary:
            row.reason === "pause"
              ? "Beendet: seit sieben Tagen pausiert, der Arbeitsstand ist abgelaufen."
              : "Beendet: die Freigabe ist abgelaufen und wurde 24 Stunden lang nicht entschieden. Es wurde nichts ausgeführt.",
          data: { reason: row.reason },
        })
        .catch(() => undefined);
      const run = await repository.requestCancellation(row.id);
      if (
        run?.status === "cancelling" &&
        (await repository.settleCancellationWithoutWorker(row.id))
      )
        closed.push({ runId: row.id, reason: row.reason });
    } catch {
      // Left for the next tick; one bad row never blocks the others.
    }
  }
  return closed;
}
