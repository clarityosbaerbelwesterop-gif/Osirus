# M42: Meta-learning and RSI V2

M42 changes how the Foundry learns. Every run records how it reasoned. Credit goes to one configuration dimension at a time. A winner that changed several fields at once is ablated before any single field is named as its cause. Hypotheses come from repeated weaknesses in experience. The order in which the Foundry spends its trials is learned per improvement mechanism.

M42 does not change what a run is allowed to do. A change still reaches the product only by one path: candidate, evaluation, champion, canary, then promotion or rollback.

This is not self-modification in production. The Foundry proposes and measures changes. The existing promotion rules decide which ones ship.

## Mechanism

| Piece                   | Where                                                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cognitive telemetry     | `intelligence/meta/telemetry.ts`, written by `experience/engine.ts` | Computed from the operational record: loop actions, the mission's hypothesis statuses, verdicts and tokens. It is never read from reasoning text. A signal the record cannot support is `null`. The full list of signals is below this table.                                                                                                                                                                                                          |
| Configuration vector    | same, written on trial and product experience                       | One value per dimension. The dimensions are listed below this table.                                                                                                                                                                                                                                                                                                                                                                                   |
| Product experience fix  | `experience/product.ts`                                             | Skills now come from `skill_usage` instead of the hard-coded `[]`. Each row also records the configuration and the assignment (champion or canary). Product rows remain metrics only and never become training data.                                                                                                                                                                                                                                   |
| Credit assignment       | `meta/credit.ts` `attributeCredit`                                  | Effects come only from pairs of configurations that differ in exactly one dimension on the same capability. Each side gets a Beta posterior, and the difference gets an interval. Rows from product runs and from provider errors are excluded.                                                                                                                                                                                                        |
| Causal ablation         | `ablationHypotheses`, `ablationCause`, `meta/foundry-meta.ts`       | See "Ablation" below this table.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Experience → hypothesis | `meta-policy.ts` `hypothesesFromExperience`                         | A telemetry weakness shared by at least 3 distinct tasks proposes one bounded intervention from a fixed template. Examples: runs finish without checking → a verify directive; coding false completions → an adversary team; numbers stated without computing → compute-first. It is evaluated like any other hypothesis.                                                                                                                              |
| Meta-policy             | `meta-policy.ts`, a `learning_artifacts` row of kind `meta_policy`  | Every hypothesis has a mechanism class (listed below this table). Each concluded experiment updates the tried count, the improved count, the mean effect and the extra cost per (gap × mechanism). The hypothesize phase gathers a pool twice the size of the challenger limit, orders it by a Thompson sample of expected gain per cost (seeded by the cycle id), and takes the top. Unseen mechanisms draw from the prior, so exploration continues. |
| Online/offline bridge   | existing canary path, product experience rows                       | Product rows carry their configuration and assignment. The canary compares the new version with the champion inside the same window (the existing `canaryEvidence`). No product row trains anything.                                                                                                                                                                                                                                                   |

**Telemetry signals:**

- hypothesis precision and rejection quality;
- replan usefulness and evidence efficiency;
- tool-choice quality;
- memory usefulness and switch quality;
- verification coverage;
- false completions avoided;
- tokens per verified success.

**Configuration dimensions:** model, tier, topology, context, memory, skill limit, skills, directives, coding, math and research knobs, and generated tools.

**Mechanism classes:** reasoning depth, tool use, model, specialist, verifier, memory retrieval, topology, compute tier, skill and generated tool.

### Ablation

1. A winner that changed two or more genome fields leaves an `ablation_result` plan with status `proposed`.
2. The next cycle for that capability tests the champion plus one of the winner's changes each. It records a `generation_runs` row of kind `ablation`.
3. When one single change reproduces at least 70% of the winner's gain, a `causal_memory` row names that change.
4. Until then, the compiler keeps any multi-field effect as `proposed`, with `confounded` listing the fields.

## Evidence

Covered by `tests/meta-learning.test.ts`:

- **Telemetry** is computed from actions and hypotheses. A signal is null where the record is silent.
- **Credit assignment.** The data has three configurations: base, `+DEEP`, and `+DEEP +computeFirst`.
  - Effects are found only for `tier` (base vs `+DEEP`) and `math` (`+DEEP` vs both).
  - The two-field difference is never compared.
  - Product rows yield no credit.
- **Ablation cause.**
  - One change carrying 28 of a 30-point gain is named the cause.
  - A 15/15 split names no cause.
- **Meta-policy.**
  - After 8 trials each (topology improved 6 of 8; compute tier 0 of 8, at 4× the tokens), topology is drawn first in more than 45 of 50 seeds.
  - An unseen mechanism is still drawn first in some seeds.
  - The ordering is identical for the same cycle id.
- **Experience → hypothesis.**
  - Three tasks with the same weakness yield two bounded hypotheses.
  - Two tasks yield none.
- **Foundry round trip on `MemoryIntelStore`:**
  1. A two-field winner writes the meta-policy and leaves an ablation plan.
  2. The next cycle's hypotheses are exactly the two single-field variants, and a generation run of kind `ablation` is recorded.
  3. The variant results name `math` as the cause in `causal_memory` and resolve the plan.

The existing Foundry suites (`foundry*.test.ts`, `intelligence*.test.ts`) pass unchanged.

## Limits

- **The meta-policy starts empty in production.** Production has no Foundry tenant yet (see the landing report), so its posteriors fill only as experiments conclude on the free model: a handful a day.
- **Product telemetry is thinner than trial telemetry.** Product rows carry skills, configuration and assignment. Loop actions are recorded only for Foundry trials.
