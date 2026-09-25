# Build log: M21 to M25 (Intelligence Foundry)

_State as of 2026-09-24, when PR #8 merged. Later milestones (M26–M38) changed some of what is described here; see their own docs._

Branch `build/m21-m25-intelligence-foundry`, started from `main` at `9113551` (M16 to M20, PR #7).

## What this series adds

- **Intelligence Plane.** The research loop runs `measure → select_agenda → generate_data → baseline → analyze → hypothesize → design → dev_eval → adversarial_eval → holdout_eval → decide → update_registry → compile → next`. Around it:
  - experience engine;
  - capability registry and gap detector;
  - curriculum, self-play and red intelligence, with label verification;
  - strategy genomes, including a critic/synthesizer team topology;
  - skill and prompt evolution;
  - value-of-compute tiers;
  - a model registry with a per-capability competition;
  - an honest `TrainingProvider` (no provider, no fake run);
  - champion/challenger experiments with paired statistics;
  - low-risk product canaries: 1 → 5 → 20 → 50 → 100 %, with automatic rollback;
  - strategic, procedural and causal memory;
  - a resource governor.
    It lives in schema `osirus_intel`. That schema is system-write only; operators can read it.
- **Production operation.** The Foundry runs inside the existing M20 scheduler tick. A bounded share of the tick: 60 s. Continuation is requested server-side after the response and is limited per day. Trials are ordinary durable runs in a sandbox-only Foundry workspace, at `runs.priority = -1`, so product work is always claimed first.
- **Product.**
  - Attachments: PDF, CSV, JSON, text and code. Parsed, chunked, retrieved by full-text search, and labelled as untrusted.
  - Signed webhooks that start automations.
  - Vercel, Neon and Supabase connectors, read-only.
  - MCP Registry search.
  - A computer arm: Chromium inside the sandbox VM.
  - A derived world model.
  - Entitlements, usage ledger, stuck-run recovery, onboarding checklist, chaos tests, and an operator guide (`docs/operator.md`).
- **Internal Intelligence Lab** at `/internal/intelligence`, for operators only. Everyone else gets 404.

## Real cycles and what they found

The Foundry runs on the free model `deepseek-v4-pro-0813:free` (operator decision). It allows about one request per minute.

**CI run 35923765911 (first live cycles).**

| Cycle  | Outcome                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coding | Ran every phase in 100 min. The champion solved 3/3 at level 0, so the curriculum raised difficulty; then 2/3. Gap found: `execution`. Two hypotheses. Decision: `no_improvement`. The compile phase produced 9 learning artifacts, 3 datasets at v1, 2/2 verified self-play mutants and 13 red tasks. |
| Math   | Every trial failed within seconds.                                                                                                                                                                                                                                                                     |

**Root cause of the math failures.** The free pool refused further calls after about 92 calls that day. `ProviderError` was caught as "not a valid decision", so the loop exhausted itself and the failure was charged to whichever strategy was running. Customer runs had the same misleading `agent_loop_exhausted`.

**Fix (`2e0ce10`).**

- A refusal ends the loop at once and is not counted against the strategy.
- A transient refusal parks the stage for as long as the provider asked, keeping its loop state.
- A permanent refusal fails the stage as `provider_<code>`.
- The Foundry records a provider pause, re-queues the trial uncounted, and starts nothing new until the pause lifts.
- The daily envelope was set to 90 calls and 36 chained ticks.

**Consequence.** A coding cycle costs about 250 to 300 calls and a math cycle about 100 to 120. On the free pool that is several days of quota. The operator decided that the cycles required for evidence run durably in production after the merge, not in CI.

**Other live checks.**

| Check                 | Run         | Result                                                                                                                                                    |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Computer arm          | 35965062452 | Passed in the real Vercel Sandbox, using `@sparticuz/chromium` with the AL2023 libraries. No model calls.                                                 |
| Math and coding rerun | 35961068558 | Completed with the refusal fix: math job 5 h 10 min, coding job 5 h 10 min, both green. Reports are in the `foundry-math` and `foundry-coding` artifacts. |

**Defects found by the chaos tests (fixed in `eb0c38c`).** A trial left in `running` with no run behind it blocked its experiment forever. Such trials now return to the queue, and any status change clears the lease.

## Migrations

Migrations `012_intelligence_foundry.sql` (156 statements) and `013_product_frontier.sql` (36 statements) are additive. None of 000–011 was modified.

**1. Replay on a disposable branch** (`br-curly-glitter-b2pt4hu1`). Both migrations applied in one transaction each, with ledger rows. Probes as `osirus_app`, all passed; the probe data was removed afterwards:

| Probe                                              | Expected result                  |
| -------------------------------------------------- | -------------------------------- |
| Read another workspace's attachments               | 0 rows                           |
| Read own attachments                               | Visible                          |
| Non-operator reads `osirus_intel`                  | 0 rows                           |
| Non-system write to Intelligence settings          | Refused                          |
| User inserts a webhook delivery                    | Refused                          |
| User writes an attachment into a foreign workspace | Refused                          |
| `byte_size` that does not match the content        | Refused                          |
| User grants an entitlement                         | Refused                          |
| High-risk strategy version set to `canary`         | Refused by the CHECK constraint  |
| Update to `promotion_events`                       | Refused (append-only)            |
| Webhook replay with the same delivery id           | Refused by the unique constraint |
| `claim_next_stage`                                 | Orders by `runs.priority` first  |

**2. Production-upgrade simulation.**

- The Neon project was at its branch limit, so a fresh production copy was not possible without deleting a branch. The disposable branch also had drifted from production (it holds older drafts of 008 and 009), so it was not an exact mirror.
- The simulation therefore ran **on production itself, inside one transaction that was forced to roll back**. It applied all 194 statements, ran the smoke checks, then raised `SIMULATION_OK` on purpose.
- Smoke checks:
  - 24 Intelligence tables with forced RLS;
  - 5 product tables with forced RLS;
  - `runs.priority` default 0;
  - both ledger rows present;
  - claim order by priority;
  - `claim_next_stage` callable by `osirus_app` in system mode;
  - anonymous reads of `osirus_intel` return 0 rows.
- The rollback was verified afterwards: still 12 ledger rows, no `osirus_intel` schema, no `priority` column.

**3. Production apply** (`br-ancient-sunset-b2d9pasu`), before the merge. It is compatible with the deployed `main`: one new column with a default, a function with the same signature, and a widened CHECK. It was applied in one transaction with the ledger rows, and the same smoke check ran inside that transaction. `/api/health` stayed `ok` afterwards (auth, database and provider all true).

## Security review of the new surfaces

| Surface            | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook receiver   | The HMAC is checked in constant time on the raw body before anything is parsed. An unknown endpoint and a bad signature get the same 401. Replays are refused by delivery id. The size cap is checked on both the header and the body. Only regex-validated fields reach an automation. Residual risk: the per-endpoint rate limit runs before the signature check, so anyone who knows an endpoint id can use up its limit. Endpoint ids are random UUIDs. |
| Attachments        | Workspace RLS on reads and writes. The type is sniffed from the bytes. The 10 MB cap is enforced in the route and in the database. Retrieved passages are labelled as untrusted file content, and each run retrieves at most 12,000 characters.                                                                                                                                                                                                             |
| Platform tokens    | Verified with the provider before they are stored, stored sealed, decrypted only for a call, and never returned. Tools are read-only. Health records carry status codes only.                                                                                                                                                                                                                                                                               |
| Operator APIs      | 404 for everyone who is not in `osirus_intel.operators`. No route can add an operator. Strict schemas. Training cannot be switched on without a real provider.                                                                                                                                                                                                                                                                                              |
| Chained tick       | Uses the scheduler secret, server-side, and only to the production URL, never from a preview. It is limited by the daily ledger. **Hardened in this review:** a hard backstop on the chain number (288), so a chain ends even if the ledger could not be charged.                                                                                                                                                                                           |
| Foundry workspace  | A deny-all policy except read and sandbox work: no push, deploy, MCP or external write. Trials never write memory, notify anyone or trigger automations.                                                                                                                                                                                                                                                                                                    |
| Intelligence Plane | Cannot touch auth, RLS, secrets, billing, DNS or destructive database operations: there are code-level denies with tests, and a database CHECK on high-risk product promotion.                                                                                                                                                                                                                                                                              |

## Known limits

- **No production account yet.** Production has no signed-in account (`neon_auth.user` is empty), so no operator can be seeded. The owner must sign in once. After that, the operator row and the Foundry settings are set with SQL.
- **Free model.** Cycles are quota-bound (about 90 calls a day), so a full coding cycle spans days.
- **No model tuning** (operator decision). The training interface reports "unavailable".
- **No product canary can start** until the product model has credit, because candidates must first be verified on it.
- **No GitHub App manifest flow.** Repository webhooks use the signed generic receiver with the existing token instead.
- **Images are stored but not read.** The configured model has no vision.
