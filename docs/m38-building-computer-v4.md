# M38 — Building / Computer / Multimodal V4

Agent that builds and verifies in real environments: UI/product changes with observation, browser/computer interaction with grounded evidence (screenshots/DOM/state), multimodal understanding tied to actions, and build-prove loops.

## What shipped

### Observe → act → verify (`src/lib/agent/observe-act-verify.ts`)

Explicit browser OAV cycle on top of the existing agent loop:

- **Observe** — snapshot URL, status, visible text, console errors, selectors, accessibility and layout.
- **Act** — typed browser actions (click, fill, press, wait) with per-action ok/fail detail.
- **Verify** — grade via production `reportFrom` against acceptance probes; never infer success from prose.

`computer.inspect` now returns `verify`, `evidenceRefs` and `groundingSummary` on every call.

### Multimodal grounding (`src/lib/agent/multimodal-grounding.ts`)

Vision/DOM/state evidence attached to hypotheses through the existing `TaskState` pipeline:

- Browser sessions → `browser:`, `screenshot:`, `action:`, `text:` refs
- QA reports → `qa:`, `check:` refs
- Attachments → `attachment:<id>:<locator>` refs

The agent loop grounds `computer.inspect` results automatically. Hypotheses move only when evidence bears on them (explicit `hypothesisIds` or statement/falsifier overlap).

### Building verification artifacts (`src/lib/building/verification-artifact.ts`)

Product builds store a markdown **verification-report** artifact after `qa-preview`:

- QA mode, URL, check pass/fail, console errors
- Screenshot viewports when present
- Contract coverage (which acceptance probes the browser found)

Artifacts are persisted via `runtime.repository.createArtifact` and cited through `evidenceRefs`.

### Capability pulse L1–L5 (`src/lib/agent/pulse.ts`)

Offline pulse suite over the production loop — not a second runtime or scheduler:

| Suite          | L1              | L2                | L3                      | L4                            | L5                      |
| -------------- | --------------- | ----------------- | ----------------------- | ----------------------------- | ----------------------- |
| **BUILDING**   | Scaffold file   | HTTP observe      | Verify probes           | Ground hypothesis             | Build-prove + artifact  |
| **COMPUTER**   | Observe DOM     | Single act        | Verify probes           | Ground hypothesis             | Full OAV + evidence     |
| **TOOL_USE**   | Request schema  | Single tool call  | Replan + retry          | Evidence refs on step         | Compute + verify        |
| **MULTIMODAL** | Read attachment | Ground attachment | Image metadata (honest) | DOM + attachment cross-ground | OAV + multimodal ground |

Run: `runPulseSuite()` in tests or `npm test -- tests/m38-pulse.test.ts`.

## Architecture

```
Objective
   │
   ▼
Agent loop (observe → decide → act)
   │
   ├─ computer.inspect ──► OAV grade + evidenceRefs
   │                              │
   │                              ▼
   │                     multimodal-grounding → TaskState.hypotheses
   │
   └─ building qa-preview ──► verification artifact + contract coverage
```

No parallel runtime. Building extends `CodingArm`; computer extends sandbox browser tools; pulse reuses `runAgentLoop` fixtures like M30 baseline.

## Tests

| File                                      | Covers                                        |
| ----------------------------------------- | --------------------------------------------- |
| `tests/m38-observe-act-verify.test.ts`    | OAV cycle, evidence refs, verify grading      |
| `tests/m38-multimodal-grounding.test.ts`  | DOM, QA, attachment grounding                 |
| `tests/m38-verification-artifact.test.ts` | Building QA artifact content                  |
| `tests/m38-pulse.test.ts`                 | Full pulse suite (20 tasks, L1–L5 × 4 suites) |

## Constraints respected

- Extended Building arm + Computer/browser capability; did not rebuild sandbox/browser stack.
- Capability first; pulse hooks are offline fixtures ready for M33 scheduling later.
- PR targets `build/m35-m44-frontier-capabilities` (integration), not `main`.
