# M34 — Capability Pulse and RSI Watchdog

M34 adds an hourly capability pulse and an in-loop RSI watchdog on the existing agent runtime. There is no second scheduler, lease store, or checkpoint machine.

## Capability lanes and levels

The pulse measures nine lanes at levels L1–L5:

| Lane | Default L3 source |
| --- | --- |
| THINKING | M30 baseline |
| REASONING | M30 baseline |
| CODING | M30 baseline |
| RESEARCH | M30 baseline |
| MATH_SCIENCE | M30 baseline |
| BUILDING_COMPUTER | M30 baseline (building at L3, computer at L4) |
| MEMORY_CONTEXT | M30 baseline |
| TOOL_MULTIMODAL | Offline compute fixture |
| CROSS_DOMAIN_LONG_HORIZON | Offline memory + synthesis fixture |

Levels without a registered task are skipped. The default suite seeds L3 for every lane.

## Hourly pulse via the scheduler

The pulse runs inside `/api/scheduler/tick`, after scheduled automations and the Foundry step, and before the claim loop.

Each tick:

1. Starts a new cycle when the previous cycle completed at least one hour ago.
2. Runs up to three pulse tasks within a 45 s budget.
3. Records results into pulse baselines used by the watchdog.
4. Requests a chained tick when the cycle is still in progress.

Chained ticks reuse the same scheduler secret and continuation envelope as the Foundry. A preview deployment never chains.

Implementation: `src/lib/agent/pulse/`.

## RSI watchdog (in-loop)

The watchdog does not replace `runAgentLoop`. Arms wrap their existing hooks with `withRsiWatchdogHooks` and call `afterAgentLoop` when a slice finishes.

When a lane’s verified outcome drops below the pulse baseline for that lane/level, the watchdog:

1. Surfaces a regression summary.
2. Inserts a benchmark experience row when the Intelligence Plane is enabled.
3. Proposes a `failure_pattern` learning artifact.

Implementation: `src/lib/agent/watchdog/`.

## Registration API (M35–M44)

Operators can list and register pulse task descriptors at:

`POST /api/internal/capability-pulse/tasks`

```json
{
  "id": "frontier:CODING:L5",
  "lane": "CODING",
  "level": 5,
  "ref": "fixture:custom-coding-l5",
  "title": "Coding L5 frontier task",
  "objective": "What the task measures"
}
```

`GET` lists built-in and registered tasks. `DELETE?id=...` removes a registration.

Later milestones resolve `ref` values to runners; M34 stores descriptors and wires built-in refs only.

## Tests

- `tests/capability-pulse.test.ts` — registry, slice budget, hourly gating
- `tests/rsi-watchdog.test.ts` — regression detection and grading
- `tests/capability-baseline.test.ts` — unchanged M30 offline baseline
