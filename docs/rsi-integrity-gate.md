# RSI integrity gate: durable pulse, one outcome contract, one suite

These are repairs to the M34 capability pulse and RSI watchdog. None of them is a new subsystem. The pulse still runs inside the existing scheduler tick, and the watchdog still feeds the Foundry through failure patterns.

## What was wrong (verified on `main` at `d6889dd`)

- **Pulse state was process-local.** It lived in module variables:
  - A cold instance started the cycle over.
  - The due check misfired.
  - The product process never saw a baseline.
- **Pulse execution defects:**
  - The suite re-ran the whole M30 baseline on every call and replayed the first result forever.
  - A skipped task never completed its cycle.
  - A task that threw stalled the cursor.
  - A pulse chain skipped the continuation envelope.
- **Outcomes were three booleans:**
  - CODING had `verifiedSuccess` hard-coded to false.
  - A missing Chromium counted as a capability failure.
  - The arena counted a provider `BLOCKED` as `failed`.
- **The watchdog judged one sample** (`MIN_BASELINE_SAMPLES = 1`) against an empty map, always at L3.
- **The M35–M38 suites were test-only.** THINKING, REASONING and MEMORY had only L3. BUILDING/COMPUTER, TOOL_USE/MULTIMODAL and CROSS_DOMAIN/LONG_HORIZON were merged lanes.

## What changed

| Area                            | Change                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable state                   | Migration `016_capability_pulse.sql` adds `osirus_intel.pulse_cycles`, `pulse_results` and `pulse_baselines`. They are system-written, operator-read and under forced RLS.                                                                                                                                                                                                                     |
| Concurrency and repeats         | A partial unique index allows only one running cycle. A cycle is driven only by its lease holder. A result is written once per (cycle, task). The cursor moves by compare-and-set.                                                                                                                                                                                                             |
| Recovery                        | A task that throws is recorded as `INFRASTRUCTURE_FAILURE` and the cursor moves on. A task removed mid-cycle is passed over. A cycle older than 6 hours is abandoned.                                                                                                                                                                                                                          |
| `src/lib/agent/pulse/runner.ts` | Runs one slice against a `PulseStore`: `PgPulseStore` in production, `MemoryPulseStore` in tests.                                                                                                                                                                                                                                                                                              |
| Outcome contract                | `src/lib/verification/outcome.ts` defines `VERIFIED_SUCCESS`, `SUCCESS_UNVERIFIED`, `PARTIAL`, `REJECTED`, `FALSE_COMPLETION`, `INCONCLUSIVE` and `INFRASTRUCTURE_FAILURE`.                                                                                                                                                                                                                    |
| Where the outcome is used       | The pulse, the product experience writer and the loop watchdog all use it.                                                                                                                                                                                                                                                                                                                     |
| How the outcome is derived      | From verdicts, deterministic checks, the finish gate and the TaskState hypotheses. "Finished with an answer" alone is at most `SUCCESS_UNVERIFIED`, and so is a VERIFY that ran without a verifier.                                                                                                                                                                                            |
| Statistical windows             | `src/lib/agent/watchdog/window.ts`: a Beta posterior over a 6-sample recent window against a reference window of up to 24 samples. A regression needs all of: at least 5 samples on each side, P(worse) ≥ 0.9 with a drop of at least 0.1, and **two consecutive evaluations**. Infrastructure failures and inconclusive runs are excluded. A false completion weighs as much as two failures. |
| Baselines                       | Versioned by suite version.                                                                                                                                                                                                                                                                                                                                                                    |
| Product windows                 | Product runs are assessed per arm family from the experience rows, with the same windows.                                                                                                                                                                                                                                                                                                      |
| One suite                       | `src/lib/agent/pulse/catalog.ts` has 12 families, levels L1–L5 and difficulty classes. The M34 lane names stay valid as aliases.                                                                                                                                                                                                                                                               |
| Cycle sampling                  | Each cycle takes two tasks per family, rotated by the cycle seed.                                                                                                                                                                                                                                                                                                                              |
| Hourly trigger                  | `.github/workflows/capability-pulse.yml` calls the existing tick every hour with a GitHub OIDC token.                                                                                                                                                                                                                                                                                          |
| OIDC check                      | `src/lib/security/github-oidc.ts` verifies the token against GitHub's JWKS, RS256 only. The token must name this repository, this workflow file, `main`, and a schedule or dispatch event. No secret is stored in GitHub.                                                                                                                                                                      |

## Coverage of the unified suite

| Family                                   | Levels                                                            | Source                                                     |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| THINKING, REASONING, MEMORY_CONTEXT      | L1, L3, L5                                                        | M30 baseline (L3), new L1/L5 in `pulse/cognition-suite.ts` |
| RESEARCH                                 | L1–L5                                                             | M36 ledger checks, plus M30 L3                             |
| MATH_SCIENCE                             | L1–L5                                                             | M37 (2 tasks per level), plus M30 L3                       |
| BUILDING, COMPUTER, TOOL_USE, MULTIMODAL | L1–L5                                                             | M38, plus M30 L3 for BUILDING and COMPUTER                 |
| CODING                                   | L3 offline (inconclusive: no model can patch offline); L1–L4 live | M30, M35                                                   |
| CROSS_DOMAIN                             | none yet                                                          | added by M39                                               |
| LONG_HORIZON                             | none yet                                                          | added by M40                                               |

**Live CODING tasks do not run in the tick.** One coding loop on the free model (about one request per minute) outlasts a 45-second tick budget, so these tasks run only where a live runner exists. Offline tasks drive the production agent loop with scripted decisions. They detect regressions in the machinery: the loop, tools, TaskState, finish gates and verifiers. They do not measure a model's knowledge.

## What the unified pulse measured on its first run (49 offline tasks, 0.4 s)

- **43 `VERIFIED_SUCCESS`.**
- **1 `REJECTED` (TOOL_USE L1).** This was a real defect:
  - The problem: a `USE_TOOL` that only asked for schemas was refused as invalid before the schemas were handed over, so progressive disclosure never happened for that request.
  - Why nothing caught it: no test asserted this case.
  - Fixed in `agent/decision.ts` and `agent/loop.ts`, with a regression test.
- **1 `INCONCLUSIVE`.** Offline coding has no model to patch with.
- **1 `INFRASTRUCTURE_FAILURE`.** This host has no Chromium for the M30 computer baseline.
- **Gate leak in 30 of 43 tasks with a probe.** A separate FINISH that claims success without evidence is accepted in most domains that have no hypotheses or success criteria. This is the known M33 limit. The pulse now reports it on every cycle as `gateLeak` instead of hiding it inside a boolean.
