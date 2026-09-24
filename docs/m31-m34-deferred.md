# DEFERRED — M31, M32, M33, M34

The capability brief stopped mid-sentence in M30.4. This PR implements M30.1 through M30.4 only. The milestones below are not designed here and not implemented here. Do not read the current memory helper, the hypothesis list, the offline baseline, or the durable runtime as substitutes for them.

## M31 — Memory OS

**Memory OS I shipped** in `build/m31-memory-os`. See `docs/m31-memory-os.md`.

What M31 I adds on top of the existing three-brain store: a `MemoryOS` coordinator, episodic prior-run retrieval, typed memory planes, entity graph writes on promotion, and a contradiction review queue. It is still not vector search, not a second scheduler, and not a Foundry bridge.

## M32 — Memory OS II / Causal World Model

Implemented on branch `build/m32-memory-os-ii`. See `docs/m32-causal-world-model.md`.

Causal links, temporal decay, and relational graphs extend the existing three-brain stack without a second runtime. `TaskState` remains the M30 cognitive record on the loop checkpoint; M32 adds persisted causal context to retrieval and `world.query`.

## M33 — Deep Thinking / Reasoning

Implemented on branch `build/m33-deep-thinking`. See `docs/m33-deep-thinking.md`.

Multi-step deliberation with M30 hypothesis states, finish gating when TaskKernel carries hypotheses or success criteria, adversarial and compound reasoning paths on the existing loop, plus docs and tests. No second scheduler.

## M34 — Hourly Capability Pulse / RSI Watchdog

DEFERRED. Awaiting the rest of the brief.

`src/lib/agent/baseline.ts` is a one-shot offline measurement. It is not scheduled, not hourly, and not a pulse over live providers. M34 owns the hourly evaluator and RSI watchdog.

## Explicitly not in this PR

- No second scheduler, lease, checkpoint store, or run state machine.
- No replacement of the agent by Foundry-only work.
- No AGI or ASI claim.
