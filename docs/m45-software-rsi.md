# M45: software RSI

Osirus proposes changes to its own code where its generated tests
prove a mechanism wrong. It never merges them. A verified patch becomes a
**draft** pull request on an `rsi/*` branch, labelled `software-rsi`, and
the operator decides.

## Pipeline

1. **Failure.** A self-play or red arena (M44) finds a deterministic Osirus
   mechanism failing its oracle.
2. **Code hypothesis.** The cycle's hypothesize phase stores a
   `code_hypothesis` naming the file, the symbol, the arena, the failing
   levels and instances. Proposals whose mechanism lies in the trust root
   are marked for the operator.
3. **Take.** `.github/workflows/software-rsi.yml` runs after each hourly
   pulse and asks `GET /api/rsi/software` for one hypothesis.
   - Authentication is GitHub OIDC only: audience `osirus-rsi`, this
     workflow file, on main.
   - Production hands out a hypothesis at most once a day. It must be
     outside the trust root and on the allowlist, and model calls are
     reserved for it from the cycle's envelope.
4. **Patch.** The free model sees the symbol, its file and the failures on
   _dev_ seeds. It returns a replacement for that symbol only.
   - At most one call per reserved call.
   - Every attempt starts from the original file.
5. **Policy** (`software-rsi/policy.ts`):
   - allowlisted paths only;
   - the trust root is refused;
   - at most 3 files and 160 changed lines;
   - added lines may not contain eval, process spawning, environment or
     secret access, network, filesystem writes, SQL, platform imports, or
     suppressed checks.
6. **Gate.** Typecheck, lint on the file, and dev seeds must improve. Then
   the whole test suite runs.
7. **Capability comparison.** The target arena is measured on **seeds the
   model never saw** (fresh per run), before and after. Every other arena and
   level is measured too, for regressions. Each measurement runs in a fresh
   process, so the numbers come from the code on disk.
8. **Decision** (`software-rsi/pipeline.ts: judgePatch`). A patch counts as
   an improvement only when all four hold:
   - it holds strictly more unseen instances;
   - no other cell got worse;
   - the typecheck and lint pass;
   - every test passes.
9. **Draft pull request.** The evidence table goes in the body. CI is
   started on the branch, because pull requests opened with the workflow
   token do not start it.
10. **Report.** `POST /api/rsi/software` settles the reserved calls. The
    hypothesis becomes `active` while the pull request waits for the
    operator. With no verified improvement it stays `proposed` and may be
    tried again the next day.

## Protected root of trust

| Area                                              | Paths refused                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication                                    | `src/lib/auth/`, `src/app/api/auth/`, middleware                                                                                                        |
| Tenancy, access, tool permissions, approval gates | `src/lib/security/`, `src/lib/entitlements/`, `src/lib/policy/`, `src/lib/agent/toolbox.ts`, `src/lib/arms/base.ts`                                     |
| Row-level security                                | `db/`, `src/lib/db/`, every `repository.ts` / `store.ts` / `db-store.ts`                                                                                |
| Secrets                                           | `src/lib/env.ts`, `scripts/`, `.env*`                                                                                                                   |
| Evaluation integrity                              | `src/lib/verification/`, `src/lib/intelligence/` (including the arenas and their oracles), `src/lib/agent/pulse/`, `src/lib/arena/`, `tests/`, `evals/` |
| Promotion rules                                   | `src/lib/strategy/`                                                                                                                                     |
| Rollback and audit log                            | `src/lib/telemetry/`                                                                                                                                    |
| Budget enforcement                                | `src/lib/runtime/{budget,settlement,worker,dispatch,executor}.ts`, `src/lib/agent/loop.ts`                                                              |
| Sandbox boundary                                  | `src/lib/sandbox/`, `src/lib/tools/registry.ts`, `src/lib/coding/{workspace,delivery}.ts`                                                               |
| Platform                                          | `.github/`, `src/app/api/`, `package*.json`, config files                                                                                               |

The `SOFTWARE_RSI` pulse family attacks these guardrails every hour:

- patches into the trust root;
- dangerous additions;
- edits to tests and oracles;
- oversized patches and bad branch names;
- the strict-improvement rule itself.

## Tests never pin a defect

A test that asserted a known Osirus defect would block the repair the
pipeline exists to make. The one such assertion was found in a local dry
run and replaced with a mechanism broken by construction.

## Verified locally (mechanics, not the proof)

A dry run (`RSI_DRY_RUN=1`, a scripted proposal instead of the model, no
push) exercised every step on `normalizeClaim`:

- 0/48 unseen instances held before the patch, 48/48 after;
- no regressions across all arenas;
- the full test suite passed;
- the file was restored.

The proof of M45 is a run of the workflow on the free model; the final
report states its outcome.

## First production runs (2026-09-25)

- **The two attempts** targeted `routeObjective` at 18:29 UTC and `addFacts` at 22:13 UTC.
- **How they ended.** The free model refused both: "All providers for model deepseek-v4-pro-0813:free are busy right now (they hit their rate limit)".
- **No proof yet.** No proposal was ever judged, so M45 is still unproven.
- **What was wrong.** Both attempts were recorded as `no_improvement`, and the loop asked the busy provider again.
- **The fix.** `proposalFailure` in `software-rsi/pipeline.ts` separates the two cases:
  - **Malformed answer** (`invalid_json`, a schema mismatch): the next attempt may do better, so the loop tries again.
  - **Provider failure** (a rate limit, no credit, a timeout, an outage): the attempt stops at once and is reported as `infrastructure_failure`. It is never a result about the code, and it spends no further calls.
