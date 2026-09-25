import { queryAs, querySystem } from "@/lib/db/client";
import type { ProbeResult, WaitProbe } from "@/lib/agent/long-horizon";
import type { NormalizedEvent } from "@/lib/webhooks/verify";

// Where the outside world ends a typed wait (M40).
//
// A stage parked on an event, a CI run or a deployment costs nothing while
// it waits: it is either `waiting` or `blocked` with a due time, and the
// claim scan skips it. Two things end the wait early, both without a model:
//
//   - a verified webhook delivery releases every matching stage in the
//     delivery's workspace (releaseWaits), and
//   - when a parked stage comes due, the arm asks deliveryProbe whether the
//     thing it waited for was recorded since the wait began.
//
// There is no second scheduler: a released stage is simply claimable again.

function refsOf(ref: string | null) {
  if (!ref) return [];
  const short = ref.replace(/^refs\/(heads|tags)\//, "");
  return [...new Set([ref, short, `refs/heads/${short}`])];
}

/** Every wait key a delivery satisfies: kind, repository and ref. */
export function eventKeysFor(
  event: Pick<NormalizedEvent, "kind" | "repository" | "ref">,
) {
  const keys: string[] = [event.kind];
  if (event.repository) {
    keys.unshift(`${event.kind}:${event.repository}`);
    for (const ref of refsOf(event.ref))
      keys.unshift(`${event.kind}:${event.repository}:${ref}`);
  }
  for (const ref of refsOf(event.ref)) keys.push(`${event.kind}:*:${ref}`);
  return [...new Set(keys)];
}

/** Which poll probe a delivery answers. */
function probeFor(kind: NormalizedEvent["kind"]) {
  return kind === "deployment"
    ? "deployment"
    : kind === "ci_failure"
      ? "ci"
      : null;
}

/**
 * Release the stages in this workspace that wait for this delivery. Scoped
 * to the endpoint's own workspace; a delivery never reaches another
 * tenant's runs. Returns the runs that became claimable.
 */
export async function releaseWaits(input: {
  workspaceId: string;
  event: Pick<NormalizedEvent, "kind" | "repository" | "ref">;
}): Promise<string[]> {
  const keys = eventKeysFor(input.event);
  const probe = probeFor(input.event.kind);
  const refs = refsOf(input.event.ref);
  const rows = await querySystem<{ run_id: string }>(
    `update osirus.run_stages s
        set status = 'blocked',
            runnable_after = null
       from osirus.runs r
      where r.id = s.run_id
        and r.workspace_id = $1::uuid
        and r.status not in ('completed', 'failed', 'cancelled', 'cancelling')
        and s.status in ('waiting', 'blocked')
        and (
          (s.output->'wait'->'wake'->>'kind' = 'event'
            and s.output->'wait'->'wake'->>'key' = any($2::text[]))
          or ($3::text is not null
            and s.output->'wait'->'wake'->>'kind' = 'poll'
            and s.output->'wait'->'wake'->>'probe' = $3::text
            and s.output->'wait'->'wake'->>'ref' = any($4::text[]))
        )
      returning s.run_id`,
    [input.workspaceId, keys, probe, refs],
  );
  return [...new Set(rows.map((row) => row.run_id))];
}

/**
 * The production probe: a wait is met when a delivery that satisfies it was
 * recorded in the caller's workspace after the wait began. Read as the
 * caller, so row-level security keeps it inside their workspace.
 */
export function deliveryProbe(input: {
  actorId: string;
  workspaceId: string;
}): WaitProbe {
  return async ({ wake, since }): Promise<ProbeResult> => {
    const kinds =
      wake.kind === "poll"
        ? wake.probe === "deployment"
          ? ["deployment"]
          : ["ci_failure"]
        : null;
    const rows = await queryAs<{
      event: string;
      summary: { repository?: string; ref?: string; status?: string };
      received_at: string;
    }>(
      input.actorId,
      `select event, summary, received_at
         from osirus.webhook_deliveries
        where workspace_id = $1::uuid
          and received_at > $2::timestamptz
          and outcome in ('triggered', 'ignored')
          and ($3::text[] is null or event = any($3::text[]))
        order by received_at desc
        limit 50`,
      [input.workspaceId, since, kinds],
    );
    for (const row of rows) {
      const event = {
        kind: row.event as NormalizedEvent["kind"],
        repository: row.summary?.repository ?? null,
        ref: row.summary?.ref ?? null,
      };
      const matches =
        wake.kind === "event"
          ? eventKeysFor(event).includes(wake.key)
          : refsOf(event.ref).includes(wake.ref);
      if (matches)
        return {
          state: "met",
          detail:
            `${row.event} ${event.repository ?? ""}@${event.ref ?? ""} ${row.summary?.status ?? ""} at ${new Date(row.received_at).toISOString()}`.replace(
              /\s+/g,
              " ",
            ),
        };
    }
    // A CI success is not delivered (only failures are): say so instead of
    // pretending the run is still going.
    return wake.kind === "poll" && wake.probe === "ci"
      ? {
          state: "unobservable",
          detail: "no CI failure reported since the wait began",
        }
      : { state: "unmet" };
  };
}
