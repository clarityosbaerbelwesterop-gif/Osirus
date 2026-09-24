import "server-only";
import { querySystem } from "../db/client";
import { RuntimeRepository } from "./repository";
import { finalizeRun } from "./worker";

// Recovery for runs nothing will ever touch again: the process that planned
// them died mid-plan, or the worker that settled their last stage died
// before closing the run. Expired stage leases are already reclaimed by
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
