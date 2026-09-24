# M36 — Research Intelligence V4

Branch: `build/m36-research-v4`  
Integration target: `integration` (via `build/m35-m44-frontier-capabilities`)

## Mission

Extend `ResearchArm` so it plans information needs, gathers evidence, triangulates sources, maintains citation-grade notes in an evidence ledger, updates beliefs under contradiction, and produces actionable briefs the agent can use for decisions — without a second runtime.

## What shipped

### 1. Stronger research planning

`researchPlanSchema` now carries:

- `informationNeeds` — decomposed needs with `required` vs `nice` priority
- `sourceStrategy` — per-authority-class gathering notes
- `stopCriteria` — documents, independent publishers, optional `minSupportedClaims`, `requireCounterEvidence`, `maxGatherSteps`

`planResearch()` and gather workers receive the richer plan in their context. `fallbackPlan()` seeds sensible defaults when the model call fails.

### 2. Evidence ledger

`src/lib/research/evidence-ledger.ts` is the citation-grade record:

| Field            | Role                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| `claims`         | statement, kind, status, confidence, supporting/contradicting source refs           |
| `contradictions` | diagnosed disagreements (`source_disagreement`, `scope_mismatch`, `temporal_drift`) |
| `beliefUpdates`  | prior → new status when contradiction weakens a belief                              |
| `openQuestions`  | unresolved items from synthesis                                                     |
| `brief`          | actionable summary for downstream decisions                                         |
| `stopMet`        | whether the plan's stop criteria were satisfied                                     |

The ledger is built after citation verification in `ResearchArm.synthesizeStage` and stored on run state as `researchLedger`.

### 3. Synthesis: fact / inference / open question

`synthesisSchema` classifies each claim:

- `fact` — must be verbatim-supported or marked insufficient/contested/stale
- `inference` — reasoned from evidence, not quoted as established
- `open_question` — not yet answerable from retrieved documents

`renderResearchAnswer()` groups findings into Facts, Possibly outdated, Contested, and Unsupported sections.

### 4. Memory integration

`src/lib/research/memory-notes.ts` writes through the existing `MemoryRepository.compileAndStore()`:

- **Episodic** — `run_summary` with the research brief
- **Semantic** — `evidence` for verified facts, `pattern` for inferences, `contradiction_status: suspected` for contested claims

No parallel memory OS was added.

### 5. Pulse suite (Research lane L1–L5)

M34 hourly pulse remains deferred (`docs/m31-m34-deferred.md`). M36 registers typed offline tasks in `src/lib/research/pulse-suite.ts`:

| Level | Task                                    | Adversarial |
| ----- | --------------------------------------- | ----------- |
| L1    | Verbatim citation acceptance            | no          |
| L2    | Two-publisher corroboration + stop rule | no          |
| L3    | Contradiction stays visible             | yes         |
| L4    | Stale-source belief weakening           | yes         |
| L5    | Full ledger + actionable brief          | yes         |

Run offline: `runResearchPulseSuite()` (see `tests/research-v4.test.ts`).

## Files

| Path                                   | Purpose                                         |
| -------------------------------------- | ----------------------------------------------- |
| `src/lib/research/evidence-ledger.ts`  | Ledger builder, belief updates, brief synthesis |
| `src/lib/research/memory-notes.ts`     | Memory compiler integration                     |
| `src/lib/research/pulse-suite.ts`      | L1–L5 offline pulse tasks                       |
| `src/lib/research/types.ts`            | Extended plan + synthesis + ledger types        |
| `src/lib/research/pipeline.ts`         | Planning and synthesis prompts                  |
| `src/lib/research/citations.ts`        | Grouped findings rendering                      |
| `src/lib/arms/research.ts`             | Arm integration                                 |
| `tests/research-v4.test.ts`            | Unit tests                                      |
| `docs/m36-research-intelligence-v4.md` | This document                                   |

## Explicitly not in M36

- No second scheduler or pulse daemon (M33/M34 still deferred)
- No replacement of the citation verifier — the ledger records its verdicts
- No schema migration — existing `research_documents`, `research_claims`, `evidence_links` tables remain authoritative

## Success criteria

- PR to integration branch with tests passing
- Evidence ledger connects claims ↔ sources ↔ confidence ↔ contradictions
- ResearchArm produces briefs distinguishing fact, inference, and open questions
- Memory notes persist through existing interfaces
- Pulse suite L1–L5 passes offline with meaningful adversarial coverage at L3+
