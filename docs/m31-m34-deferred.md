# DEFERRED — M31, M32, M33, M34

The capability brief stopped mid-sentence in M30.4. This PR implements M30.1 through M30.4 only. The milestones below are not designed here and not implemented here. Do not read the current memory helper, the hypothesis list, the offline baseline, or the durable runtime as substitutes for them.

## M31 — Memory OS

**Memory OS I shipped** in `build/m31-memory-os`. See `docs/m31-memory-os.md`.

What M31 I adds on top of the existing three-brain store: a `MemoryOS` coordinator, episodic prior-run retrieval, typed memory planes, entity graph writes on promotion, and a contradiction review queue. It is still not vector search, not a second scheduler, and not a Foundry bridge.

## M32 — Deep Cognition

DEFERRED. Awaiting the rest of the brief.

`TaskState` and the evidence-sensitive hypothesis update are the M30 cognitive record on the existing loop checkpoint. They are not a deep-cognition stack, and this PR does not add one.

## M33 — Hourly Capability Pulse

DEFERRED. Awaiting the rest of the brief.

`src/lib/agent/baseline.ts` is a one-shot offline measurement for this PR. It is not scheduled, not hourly, and not a pulse over live providers.

## M34 — RSI Watchdog

DEFERRED. Awaiting the rest of the brief.

No watchdog process was added. The brief’s direction is that recursive self-improvement is not a separate watcher: the agent is supposed to change from its own experience. This PR does not claim that change, and it does not add a second runtime to watch for it.

## Explicitly not in this PR

- No second scheduler, lease, checkpoint store, or run state machine.
- No replacement of the agent by Foundry-only work.
- No AGI or ASI claim.
