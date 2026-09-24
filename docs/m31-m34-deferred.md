# DEFERRED — M31, M32, M33, M34

The capability brief stopped mid-sentence in M30.4. This PR implements M30.1 through M30.4 only. The milestones below are not designed here and not implemented here. Do not read the current memory helper, the hypothesis list, the offline baseline, or the durable runtime as substitutes for them.

## M31 — Memory OS

**Memory OS I shipped** in `build/m31-memory-os`. See `docs/m31-memory-os.md`.

What M31 I adds on top of the existing three-brain store: a `MemoryOS` coordinator, episodic prior-run retrieval, typed memory planes, entity graph writes on promotion, and a contradiction review queue. It is still not vector search, not a second scheduler, and not a Foundry bridge.

## M32 — Deep Cognition

DEFERRED. Awaiting the rest of the brief.

`TaskState` and the evidence-sensitive hypothesis update are the M30 cognitive record on the existing loop checkpoint. They are not a deep-cognition stack, and this PR does not add one.

## M33 — Deep Thinking / Reasoning

Implemented on branch `build/m33-deep-thinking`. See `docs/m33-deep-thinking.md`.

Multi-step deliberation with M30 hypothesis states, finish gating when TaskKernel carries hypotheses or success criteria, adversarial and compound reasoning paths on the existing loop, plus docs and tests. No second scheduler.

## M34 — Hourly Capability Pulse / RSI Watchdog

Implemented in M34. See `docs/m34-capability-pulse-rsi.md`.

`src/lib/agent/baseline.ts` remains the offline M30 measurement. The hourly pulse reuses those fixtures through `src/lib/agent/pulse/` and the existing scheduler tick. The watchdog runs in-loop on production agent slices and feeds regressions into experience. It does not replace the agent loop and does not add a second runtime.

## Explicitly not in this PR

- No second scheduler, lease, checkpoint store, or run state machine.
- No replacement of the agent by Foundry-only work.
- No AGI or ASI claim.
