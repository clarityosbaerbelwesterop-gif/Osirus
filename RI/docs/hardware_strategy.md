# Hardware Strategy

## CPU-First Mandate

All work begins on available CPU. E1 measured runtime: ~0.001–0.003 seconds per full experiment (100 train + 50 test samples, 3 seeds). Peak memory negligible.

## When GPU would be considered

Only after measured bottlenecks in numerical operations that benefit from parallel matrix computation, with identical evaluation criteria on CPU vs GPU.

Current evidence: none. Symbolic/relational counting is efficient on CPU.

## Target envelope (investigative only)

Possible later frame: single high-end GPU (e.g. B200 class) with ~100 GB memory budget. This is a resource question, not a claim that expert intelligence is achievable within it.

No paid instances activated.
