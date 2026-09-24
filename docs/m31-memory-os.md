# M31 — Memory OS I

Memory OS I is a coordinator over the existing three-brain store. It does **not** replace Memory Compiler v2, Postgres tables, or the runtime scheduler. It strengthens how episodic, semantic, procedural, and strategic memory are retrieved, committed, and reviewed.

## What changed

### MemoryOS coordinator (`src/lib/memory/os.ts`)

Single entry point for product memory:

| Method                   | Role                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `retrieveBundle()`       | Merges lexical retrieval with episodic prior-run lookup; routes items into four planes |
| `retrieve()`             | Backward-compatible flat list (arms, tools, loop)                                      |
| `commit()`               | Wraps Compiler v2 promotion and entity indexing after verified runs                    |
| `listContradictions()`   | Surfaces `contradiction_status = 'suspected'` items                                    |
| `resolveContradiction()` | Calls existing `resolveConflict()` on the repository                                   |

### Memory planes (`src/lib/memory/planes.ts`)

Cognitive planes are routing labels, not new tables:

| Plane          | Source kinds / signals                                                  |
| -------------- | ----------------------------------------------------------------------- |
| **Episodic**   | `run_summary`; prior-run lookup by objective                            |
| **Semantic**   | `fact`, `project_map`, `constraint`, `evidence`, …                      |
| **Procedural** | `pattern` and `source.memory` starting with `experience.`               |
| **Strategic**  | `decision`, third-brain summaries, high-importance verified constraints |

Context lines are prefixed with `[plane/tier/verification]` so First Brain and the agent loop see typed memory instead of a flat string list.

### Episodic prior-run retrieval

`MemoryRepository.episodicByObjective()` joins `memory_items` to `runs` and ranks by objective similarity. This answers “what did we learn last time we worked on Atlas?” without guessing from unrelated FTS hits.

### Entity graph writer (`src/lib/memory/entities.ts`)

On verified promotion, repo-scoped `project_map` and `experience.command` candidates now populate `memory_entities` and `memory_relations`. The graph-augmented retrieval path in `repository.retrieve()` was already implemented; M31 activates the write side for repository/framework/workflow entities.

### Contradiction queue

Suspected conflicts were already marked by Compiler v1/v2 (`MARK_CONFLICT`) and excluded from retrieval. M31 adds:

- Settings UI queue with **Keep this value**
- `POST /api/memory/conflicts/resolve`
- Count badge on the Memory settings page

## Integration points

- `src/lib/runtime/worker.ts` — `learnFromRun()` uses `MemoryOS.commit()`
- `src/lib/arms/base.ts` — retrieve stage and agent loop use `retrieveBundle()`
- `src/lib/arms/types.ts` — `ArmRuntime.memory` is now `MemoryOS`
- `src/lib/product/settings.ts` — memory overview includes conflict queue

## Honest limits (still true after M31 I)

- **No vector search.** `memory_embeddings` remains unused JSONB; retrieval is FTS + entity graph + episodic join.
- **No Foundry bridge.** Strategic/procedural artifacts in `osirus_intel.learning_artifacts` are still lab-only and not fed into product retrieval.
- **No cross-workspace memory.** Everything stays tenant- and workspace-scoped under RLS.
- **No automatic distillation scheduler.** Third-brain promotion still follows Compiler v1 rules at commit time only.
- **Strategic plane is product-heuristic.** It is not the Foundry `strategic_memory` artifact type; that remains separate.
- **Contradiction resolution is manual.** The queue surfaces conflicts; the agent does not auto-pick winners yet.

## Tests

```bash
npm test -- tests/memory-os.test.ts tests/memory.test.ts tests/memory-compiler-v2.test.ts
```

## Next (M31 II+, not in this slice)

- Agent action `RESOLVE_MEMORY_CONFLICT`
- Cross-project episodic index
- Foundry → product memory bridge (with explicit policy)
- Embedding-backed retrieval behind the same MemoryOS interface
