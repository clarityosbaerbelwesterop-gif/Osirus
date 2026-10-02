# AI Lab — Budget and Authorization Policy (Phase K)

Date: 2026-10-02 · Branch: `ai-lab/runpod` (from `ai-lab/foundation`, never
merges to `main`) · Status: **TRAINING_READY = FALSE — zero spend, zero
provisioning.**

This document fixes the budget and release policy for GPU infrastructure
(RunPod / H200 scale path). It is binding for every experiment branch. The
enforcing code lives in `ai-lab/infra/runpod.ts`; this file is the policy
that code implements.

## 1. Zero-spend default

- The default posture of every provider instance is **dry-run**: methods
  return planned actions only. No API call, no provisioning, no spend.
- The Phase K adapter ships **no network transport**. Even a fully authorized
  configuration cannot place a real order from this scaffold
  (`TransportUnavailableError`).
- No credentials exist in this repository. API keys are never committed and
  are supplied from the environment at the call site only, after the release
  flow in § 2 has completed.

## 2. Owner authorization flow

Real provisioning requires ALL of the following, in order:

1. **Stage D written proposal** (per `docs/ROUGE_RESEARCH_HANDOFF.md`):
   data, budget, expected metrics, rollback.
2. **Written owner sign-off** on that proposal (explicit "go", recorded with
   the experiment registry entry).
3. **Phase L gate** passes and `TRAINING_READY=TRUE` is set by the owner.
   Current state per `docs/PRODUCTION_CERTIFICATION.md`: **FALSE** (billing
   absent, observability PARTIAL).
4. At runtime, the code-level authorization triple must hold:
   `OSIRUS_TRAINING_READY === "true"` **and** an API key is provided **and**
   `dryRun === false`. Missing any one of these, provider methods throw
   `NotAuthorizedError`.

No single step can be skipped, and no agent may flip `TRAINING_READY` — that
is an owner decision, recorded in writing.

## 3. Estimate → approve → run

Every run follows this sequence, without exception:

1. **estimate** — `GpuProvider.quote(req)` computes the worst-case cost from
   the profile catalog (`estimatedTotalUsd = hourly rate × maxRuntime`).
   Quotes are pure computation and are always free.
2. **approve** — the estimate is checked against the `BudgetGuard` ceilings
   (per-run and total). Over ceiling → `BudgetExceededError`, no run. Within
   ceiling → owner (or the owner-delegated budget) approves in writing.
3. **run** — only after approval, and only within the recorded estimate and
   the mandatory shutdown policy.

## 4. Budget ceilings and ledger

- `BudgetGuard` enforces two hard ceilings: `maxUsdPerRun` (worst-case
  estimate of a single run) and `maxUsdTotal` (cumulative spend).
- Actual spend is recorded in an in-memory ledger via `recordSpend`. The
  ledger is process-local; durable accounting belongs to the Phase H registry
  layer. The ledger never accepts an entry that would push total spend past
  the ceiling.
- GPU profile prices in `runpod.ts` are **catalog estimates for budgeting
  only** — they are never used to place an order. **No spend before
  TRAINING_READY.**

## 5. Auto-shutdown obligation (kill switch)

- Every provision request carries a mandatory `ShutdownPolicy` with
  `autoShutdownAfterMs` — a hard deadline after which the instance must be
  terminated automatically.
- `maxRuntimeMs` of a run may never exceed the shutdown deadline.
- The deadline is bounded by `MAX_AUTO_SHUTDOWN_MS` (24 hours). Longer runs
  must be decomposed into checkpointed segments with resume, matching the
  checkpoint contract (`parentId` lineage).
- A run without a valid shutdown policy fails validation and must not reach
  a provider.

## 6. Non-goals for Phase K

- No real API integration, no transport, no retry logic, no spot-market
  logic, no multi-provider failover.
- No secrets management beyond "keys come from the environment at the call
  site, never from the repository".
