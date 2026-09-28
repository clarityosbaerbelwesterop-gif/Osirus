# Rouge model-system prototype (M56–M57): legacy research

**Status:** archived research. It is not Rouge 1's identity.

Rouge 1 is now a trained model (see [`native-model.md`](native-model.md)).
The code below stays in the repository because parts of it remain useful.
Nothing in it counts as Rouge intelligence progress.

## What was built (merged into main at `716f1f7`)

- **M56**, `src/lib/rouge/*`, merged in #34, #35 and #37:
  - the foundation adapter to an external core through UnoRouter;
  - the core ladder, with measured substitution to
    `nemotron-3-ultra-550b-a55b:free`;
  - versioned runtime policies and content-free telemetry;
  - the raw-core-vs-Rouge evaluation workflow (`rouge-eval.yml`).
- **M57**, `src/lib/rouge/kernel/*`, `/api/rouge`, #36:
  - a deterministic answer-contract layer (policy p1, the current default);
  - a multi-call "cognitive kernel" (policy p2, opt-in): task model,
    parallel approaches, agreement, adjudication or verification, and
    synthesis;
  - a procedurally generated, code-checked capability benchmark with paired
    statistics.

## What is kept, and for what

| Kept                                                                           | Future use                                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `/api/rouge` (auth, same-origin, limits, SSE) and the stream event types       | The AI-mode endpoint for the Rouge checkpoint (M71), with the foundation adapter pointed at our own serving  |
| Content-free telemetry, versioning, honest served-model labelling              | Serving telemetry per checkpoint                                                                             |
| `evals/rouge/m57-benchmark.ts` generators and checkers, `evals/rouge/stats.ts` | Verified task sources for reasoning training (disjoint train seeds) and Model Lab statistics (M60, M64, M69) |
| The contamination and blind-seed discipline                                    | Data engine and Lab (M62, M69)                                                                               |

**What is not continued:**

- runtime deliberation as the source of Rouge's capability;
- fallback cores answering as Rouge;
- tuning the M57 gate.

## Evidence (preserved)

| Run         | What                                                                      | Result                                                                                                             |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 36324746302 | Core selection tournament, 11 cores, 21 tasks                             | Nemotron 21/21; the others were unavailable or below 80%                                                           |
| 36382174724 | M57 dev #1, 30 tasks, 10 calls in flight                                  | Not scorable. Rate limits failed 14/30 raw and 16/30 self-consistency tasks. Raw was right on 16/16 answered.      |
| 36386430279 | M57 dev #2: harder tiers, retries, raw vs p2, 40 tasks                    | Budget ran out after 20 tasks. Raw 16/16, Rouge 17/17 on the tasks each answered. Medians: 248 s raw, 958 s Rouge. |
| 36419340339 | Raw-only calibration: knights, ordering, trace, list-ops, base conversion | Raw 15/15 correct, 5 provider time-outs, 4 h                                                                       |
| 36448852510 | Laguna dev run                                                            | Cancelled at the owner's direction                                                                                 |

The run artifacts are kept for 30 days from each run.

**Conclusion.** On the free Nemotron core, all 47 answered tasks across the
ten generated families were correct. There was nothing for a runtime
kernel to fix. Throughput made large blind runs take hours per few dozen
tasks. The M57 gate was never passed and is no longer pursued.

The unmerged branch `rouge/m57-gate` holds the last evaluation changes. It
is **not** to be merged.
