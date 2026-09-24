# M35 — Coding Intelligence V4

Vertical slice on branch `build/m35-coding-v4`, merged into `build/m35-m44-frontier-capabilities` (not `main`).

## What landed

### M35.1 SoftwareWorldModel

**Module:** `src/lib/coding/software-world-model.ts`

Decision-useful structure built when a coding workspace opens (and refreshed after edits):

- Modules/packages, entry points, exports, imports
- Symbols (functions, classes, constants) with file + line
- Call edges (heuristic, JS/TS/Python)
- API routes (Next.js route handlers, Express-style)
- DB access points and auth boundaries (pattern-matched)
- Test mappings (test file → imported targets)
- Config/deploy hints from manifests, CI, Docker, Vercel

Persisted on `WorkspaceRecord.softwareWorldModel` and rendered into the answering loop when `strategy.genome.coding.worldModel` is `summary` or `full`.

Limits: no full AST; regex/heuristic only. Missing edges mean “not indexed yet”, not “does not exist”.

### M35.2 Semantic navigation

**Module:** `src/lib/coding/navigation.ts`  
**Tool:** `workspace.navigate`

Operations:

| Op | Purpose |
|----|---------|
| `find_definition` | Symbol → defining file/line |
| `find_references` | Model call edges + repo grep |
| `symbol_search` | Model symbols + grep |
| `import_graph` | Import edges from/to a path |
| `call_relationships` | Caller/callee edges |
| `test_mapping` | Test files → targets |
| `route_mapping` | HTTP routes |
| `schema_mapping` | Schema files + DB access points |
| `git_blame` | Line history via git blame |

Prefer `workspace.navigate` over reading whole directories.

### M35.3 Bug reproduction first

**Module:** `src/lib/coding/reproduction.ts`  
**Tool:** `workspace.reproduce`

`ReproductionArtifact` fields: `command`, `environment`, `expected`, `actual`, `status`, `evidencePaths`, optional `failureClass`.

- Bug-class objectives detected via `isBugClassTask()`
- When `genome.coding.reproduceFirst` is true and a workspace is available, the verifier runs `reproduction-before-patch`
- Failed test runs via `workspace.run` auto-record a reproduction artifact
- Agents can also record explicitly with `workspace.reproduce`

Statuses: `pending`, `reproduced`, `not_reproducible`, `skipped`.

### M35.4 Hypothesis → patch → verify

Existing M30 TaskKernel / VERIFY / arm checks unchanged; this slice adds:

- Directives to use VERIFY after a green test run
- `reproduction-before-patch` verification check on bug tasks
- `claims-match-evidence` and independent `run-checks` unchanged

False completion is still blocked when the answer claims green tests but command evidence disagrees.

## How CodingArm uses it

1. **open-workspace** — builds `RepositoryMap` + `SoftwareWorldModel`
2. **answer** — toolbox includes `workspace.navigate`, `workspace.reproduce`; policy may inject world model + reproduction policy lines
3. **run-checks** — independent test/build evidence (unchanged)
4. **verify** — includes reproduction gate when configured

Genome knobs (`src/lib/strategy/runtime.ts`):

```typescript
coding: {
  repoContext: "none" | "summary" | "full",
  worldModel: "none" | "summary" | "full",
  reproduceFirst: boolean,
  failureHints: "off" | "structured",
}
```

Foundry candidate added in `src/lib/intelligence/strategies/genomes.ts` for `worldModel: "summary"`.

## M34 Capability Pulse hooks

M34 hourly pulse is **not** scheduled on this branch. Typed registration lives at:

`src/lib/intelligence/pulse/coding-suite.ts`

- `PULSE_CODING_REGISTRATION` — suite id, hook path, evaluator pointers
- `PULSE_CODING_TASKS` — L1–L3 tasks plus one L4 compound task (median + mean, hidden check)

M34 should import `PULSE_CODING_REGISTRATION` and wire tasks into the pulse scheduler alongside `src/lib/arena/gate.ts` and `src/lib/agent/baseline.ts`.

## Tests

```bash
pnpm test tests/coding-intelligence.test.ts
pnpm test
```

## Honest limits

- World model is heuristic, not semantic-analysis-grade
- Call graph and cross-language edges are incomplete
- Reproduction gate depends on strategy genome + workspace availability
- No second scheduler or pulse runner added (M34 deferred)
