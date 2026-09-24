# M32 — Memory OS II / Causal World Model

Memory OS II extends the existing three-brain stack (first-brain context assembly, second/third-brain persistence, Memory Compiler v2) with a **causal / temporal / relational world model**. It does not add a second runtime, scheduler, or checkpoint store.

## What M32 adds

| Layer          | Responsibility                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Causal**     | Links actions to outcomes from recorded tool runs, check runs, research retrieval, and agent steps     |
| **Temporal**   | Exponential decay on retrieval and ranking; recent verified experience outranks stale items            |
| **Relational** | Entity/relation graph persisted in `memory_entities` and `memory_relations` for neighborhood expansion |

## Architecture

```
Run checkpoint state
        │
        ▼
extractCausalGraph()  ──► memory_entities + memory_relations (persist)
        │
        ▼
assembleCausalWorldModel() ──► formatCausalContext()
        │
        ├── retrieve-memory stage (first brain)
        ├── agent loop RETRIEVE_MEMORY hook
        └── world.query tool (via buildWorldModel.causal)
```

### Integration points (no replacement)

- **First brain** — `retrieveMemoryStage` and the agent-loop `retrieveMemory` hook prepend `[causal]` / `[relational]` lines before lexical memory hits.
- **Second brain** — `MemoryRepository.retrieve` applies temporal scoring after full-text rank.
- **Third brain** — unchanged; Memory Compiler v2 still promotes only verified outcomes.
- **World model** — `buildWorldModel` optionally attaches a `causal` slice from persisted graphs.

### Persistence

M32 uses existing tables only:

- `memory_entities` — causal events (`action`, `outcome`, `observation`) and relational nodes
- `memory_relations` — `caused`, `preceded`, `enabled`, `contradicted`
- `memory_items` — unchanged; compiler v2 patterns remain the promotion path

`learnFromRun` in `src/lib/runtime/worker.ts` calls `persistCausalGraph` after `memoryCandidates` for every settled run.

## Key modules

| Module                  | Path                                   |
| ----------------------- | -------------------------------------- |
| Temporal decay          | `src/lib/memory/temporal.ts`           |
| Causal extraction       | `src/lib/memory/causal.ts`             |
| World model assembly    | `src/lib/memory/causal-world-model.ts` |
| Persistence + retrieval | `src/lib/memory/repository.ts`         |
| World query enrichment  | `src/lib/world/model.ts`               |

## Tests

`tests/causal-world-model.test.ts` covers temporal decay, causal extraction from run evidence, narrative rendering, and first-brain formatting.

## Deferred (not M32)

- FINISH-gate / false-completion probes → M33 Deep Thinking
- Hourly capability pulse → M33/M34
- RSI watchdog → M34

See `docs/m31-m34-deferred.md` for the full milestone split.
