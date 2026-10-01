# OSIRUS — Agent Architecture (as implemented)

Audit date: 2026-10-01 · Ref: `main` @ `716f1f7` · Verified against code; README claims cross-checked.

## Verdict

OSIRUS Agent is a **real agent system**, not a fixed UI sequence and not a single-LLM-call wrapper. Planning, tool selection, verification, replanning, failure recovery, and durable long-running execution are all implemented.

## Execution flow (entry to completion)

1. **Entry** — `POST /api/runtime` (`src/app/api/runtime/route.ts`): Neon Auth session → same-origin check → rate limit (12/user) → zod `{objective, requestId, sessionId, attachmentIds}` → `prepareRuntimeRun` → `executeRuntimeRun` (`src/lib/runtime/executor.ts`), streamed as SSE. Idempotent per `requestId`.
2. **Planning** — `routeObjective` (`src/lib/runtime/router-v2.ts`): heuristic per-arm scoring → compound segmentation → escalates to schema-validated `TaskAnalysis` (THINKING role) only when genuinely ambiguous. Output: persisted **DAG of stages** (`db/migrations/008_workflow_engine.sql`), acceptance contract, run budget (default 40 model calls / 100 tool calls / 30 min).
3. **Execution** — stages claimed under `lease_token` (`claimNextStage`, SKIP LOCKED), executed in ≤240s slices with checkpoints (budget charge + checkpoint in one transaction), resumed by next request / client poll / scheduler tick. Retries capped per-stage; transient provider refusals park stages as BLOCKED with `refusalDelaySeconds`.
4. **Agent loop** — `runAgentLoop` (`src/lib/agent/loop.ts`): observe–decide–act–verify. Schema-validated decisions over `USE_TOOL / RESPOND / FINISH / VERIFY / REPLAN / SPAWN_WORKER / RETRIEVE_MEMORY / CREATE_ARTIFACT / REQUEST_APPROVAL / WAIT / YIELD`. Bounds: 12 steps, 14 model calls, 10 tool calls, 150s/slice, 3 consecutive failures. Progressive tool-schema disclosure; persisted cognitive kernel (hypotheses, evidence refs, open questions — `task-state.ts`); finish gates; max 2 auto-replans; typed long-horizon waits; critic/synthesizer team review; per-arm verify stage + mission-level meta-verifier.
5. **Settlement** — usage ledger written per run (`worker.ts`); stage budget settlements; security events for injection flags/redactions.

## AI MODE vs AGENT MODE

Both exist **inside every run**, decided per stage: an arm with a non-empty toolbox runs the full agent loop; otherwise `streamAnswer` (single streamed model call, same system contract + verification). There is no fake "agent mode" badge — one runtime serves both.

## Model layer ("UnoRouter")

Single OpenAI-compatible provider (`UNOROUTER_BASE_URL` + ≤3 keys). Roles: FAST/STRONG/THINKING/CODING/RESEARCH/MATH/VERIFY. Free-model-first policy with live pool discovery from `/v1/models`, per-model cooldowns honoring Retry-After, capacity admission P0–P4, strict anti-evasion key-failover (429/credit never rotates keys). **No second vendor is wired** — residual availability risk.

## Arms

Six arms behind the `AgentArm` interface (`src/lib/arms/`): thinking, coding, research, math-science, building, general — sharing a 62KB base runtime; mission/team/horizon runtimes on top.

## Memory

MemoryOS (`src/lib/memory/`): episodic/semantic/procedural/strategic planes, contradiction handling, causal graph, entity extraction — **lexical only (JSONB), no vector search**. Retrieval includes `workspace_id IS NULL` owner-global rows (cross-workspace within one account, not cross-tenant). Research memory-notes persist claims with verification status; rejected/suspected items excluded from retrieval — but a poisoned "verified" item is trusted later (noted for Phase F).

## Tool & permission model

Per-arm visibility, zod input validation, fail-closed approval gate (any `external` effect or `high` risk), approvals bound to tool+exact validated input+MCP fingerprint with 1h expiry, replay-safe decision endpoint. Action ledger gives exactly-once semantics for external calls across crashes. All attempts (incl. denials) audited to `osirus.tool_calls` metadata-only.

## Failure handling

Distinct provider failure classes exist (unavailable / quota / rate-limited / invalid credentials / timeout / network / internal) via `src/lib/models/provider.ts` failure reports; retries are bounded and idempotent (requestId + action ledger). UI surfacing quality of these distinctions is a Phase H verification item.

## Intelligence plane

`src/lib/intelligence/` (26 dirs): Foundry generation arenas, RSI phases, pulse suites, strategy genomes, promotion, synthesis (generated tools are quarantined + forced read-only/low-risk). Runs only via scheduler tick / GitHub workflows, P4-priority capacity gated. DB schema `osirus_intel` (28 tables, RLS+FORCE; `operators` table empty → effectively system-only today).

## Known architectural debts

1. Two routers live in different layers (`router.ts` regex vs `router-v2.ts` scoring) — consolidate or document deliberately.
2. No persistent sandbox across a run (per-stage; README admits).
3. Injection detection is regex-shallow (6 patterns); defense-in-depth relies on fencing + approval gating.
4. No user-configurable run budgets; no cost circuit-breaker surfaced in UI.
5. `attachments` content stored as `bytea` in Postgres — fine now, plan object storage at scale.
