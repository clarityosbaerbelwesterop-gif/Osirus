// How tools have actually behaved in this workspace.
//
// Read from tool_calls, the audit every invocation already writes. The result
// is a routing hint for the agent -- which tool has been reliable and fast --
// and nothing more: it never changes a tool's permissions, its approval
// requirement or which arms may see it.

export type ToolStats = {
  tool: string;
  calls: number;
  successRate: number;
  p50LatencyMs: number | null;
  topFailure: string | null;
};

export type ToolCallRow = {
  tool_name: string;
  calls: number | string;
  completed: number | string;
  p50: number | string | null;
  top_failure: string | null;
};

export const TOOL_PERFORMANCE_SQL = `
  select tool_name,
         count(*) as calls,
         count(*) filter (where status = 'completed') as completed,
         percentile_cont(0.5) within group (order by latency_ms) as p50,
         mode() within group (order by error_code)
           filter (where error_code is not null) as top_failure
    from osirus.tool_calls
   where workspace_id = $1::uuid
     and created_at > now() - interval '30 days'
     and status in ('completed', 'failed')
   group by tool_name
  having count(*) >= 3
   order by count(*) desc
   limit 40`;

export function toolStats(rows: ToolCallRow[]): ToolStats[] {
  return rows.map((row) => {
    const calls = Number(row.calls);
    return {
      tool: row.tool_name,
      calls,
      successRate: calls > 0 ? Number(row.completed) / calls : 0,
      p50LatencyMs: row.p50 === null ? null : Math.round(Number(row.p50)),
      topFailure: row.top_failure,
    };
  });
}

/** One line per tool the agent is offered, for its prompt. Data, not rules. */
export function performanceHints(stats: ToolStats[], offered: string[]) {
  const offeredSet = new Set(offered);
  return stats
    .filter((entry) => offeredSet.has(entry.tool))
    .map(
      (entry) =>
        `${entry.tool}: ${Math.round(entry.successRate * 100)}% success over ${entry.calls} call(s)${
          entry.p50LatencyMs !== null ? `, median ${entry.p50LatencyMs} ms` : ""
        }${entry.topFailure ? `, most common failure ${entry.topFailure}` : ""}`,
    );
}
