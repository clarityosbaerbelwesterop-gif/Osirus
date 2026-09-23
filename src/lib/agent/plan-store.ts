import "server-only";
import { queryAs } from "../db/client";
import type { PlanRevision, PlanRevisionStore } from "./plan";

// Plan revisions in plan_revisions, under the run's row-level security. The
// revision number is assigned in the insert itself; the unique (run_id,
// revision) constraint turns a concurrent double-append into an error rather
// than two revisions with the same number.

type Row = {
  revision: number;
  reason: string;
  graph: Omit<PlanRevision, "revision" | "reason">;
};

export class DbPlanRevisionStore implements PlanRevisionStore {
  constructor(private readonly actorId: string) {}

  async list(runId: string) {
    const rows = await queryAs<Row>(
      this.actorId,
      `select revision, reason, graph
         from osirus.plan_revisions
        where run_id = $1
        order by revision`,
      [runId],
    );
    return rows.map((row) => ({
      revision: row.revision,
      reason: row.reason,
      ...row.graph,
    }));
  }

  async append(runId: string, revision: Omit<PlanRevision, "revision">) {
    const rows = await queryAs<{ revision: number }>(
      this.actorId,
      `insert into osirus.plan_revisions (run_id, revision, reason, graph)
       select $1, coalesce(max(revision), 0) + 1, $2, $3::jsonb
         from osirus.plan_revisions where run_id = $1
       returning revision`,
      [
        runId,
        revision.reason.slice(0, 1_000),
        JSON.stringify({
          trigger: revision.trigger,
          plan: revision.plan,
          resolutions: revision.resolutions ?? [],
        }),
      ],
    );
    return { ...revision, revision: rows[0]!.revision };
  }
}
