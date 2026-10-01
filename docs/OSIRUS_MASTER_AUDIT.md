# OSIRUS — Master Audit (spec § 1, categories A–J)

Date: 2026-10-02 · Audited ref: `main` @ `f3a84ab97f447a717f1add8511db332686b3f58b`
Method: fresh tarball extraction of the audited ref; full tree enumeration; direct file reads; quality gate re-run (`tsc`, `vitest`, `prettier`, `eslint`); production Neon catalog inspection (project `super-voice-69875601`); GitHub branch/PR census via API. No claim in this document is carried over from prior docs without re-verification.

## Verified measurements (this audit)

| Measurement                            | Value                                                   | Source                            |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| TypeScript files in `src/`             | 412 (.ts/.tsx)                                          | tree enumeration                  |
| Unit test files                        | 83 (82 run, 1 skipped)                                  | `vitest run`                      |
| Unit tests                             | **985 passed, 2 skipped** (987 total), 112s             | `vitest run`                      |
| `tsc --noEmit`                         | clean                                                   | gate run                          |
| `prettier --check` / `eslint`          | clean                                                   | gate run                          |
| DB migrations (files)                  | 21 (`db/migrations/000`–`020`)                          | tree enumeration                  |
| DB migrations (applied, production)    | 21, latest `020` at 2026-10-01T15:44:45Z                | `osirus.schema_migrations` ledger |
| Tables with RLS ENABLED + FORCED       | **81** (schemas `osirus` + `osirus_intel`)              | `pg_class`                        |
| RLS policies                           | **143** (88 `osirus` + 55 `osirus_intel`)               | `pg_policy`                       |
| Functions with residual PUBLIC EXECUTE | **0** (all 18 in both schemas)                          | `pg_proc.proacl` inspection       |
| Branches                               | 41 (37 fully merged/dead, 3 rouge experimental, `main`) | GitHub API                        |
| Open PRs                               | 0                                                       | GitHub API                        |
| App pages / API routes                 | 17 `page.tsx` / 40 `route.ts`                           | tree enumeration                  |

**Correction to prior docs:** earlier audit rounds stated "180 policies". The verified live count is **143** (88 + 55). PROJECT_STATE.md will be aligned in a later pass; the number here is authoritative.

---

## A. IMPLEMENTED (verified against code + production)

| Area                                                                                                                                                                         | Evidence                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Durable DAG runtime (leases, slices, checkpoints, budget in one transaction)                                                                                                 | `src/lib/runtime/`, `osirus.claim_next_stage` (SKIP LOCKED + lease fencing), migrations 008/009/014/015 |
| Six agent arms behind one interface                                                                                                                                          | `src/lib/arms/` (thinking, coding, research, math-science, building, general), `router-v2.ts` scoring   |
| Verification engine (deterministic outranks model; MODEL-only caps at unverified)                                                                                            | `src/lib/verification/engine.ts` + tests                                                                |
| UnoRouter provider (single OpenAI-compatible endpoint, ≤3 keys, free-model-first, live pool discovery, cooldowns)                                                            | `src/lib/models/unorouter.ts`, `free-registry.ts`                                                       |
| Tool registry, fail-closed approval gates (bound to tool+input+MCP fingerprint, 1h expiry)                                                                                   | `src/lib/tools/registry.ts`, `src/app/app/approvals/`                                                   |
| MCP client + registry + UI (Streamable HTTP, definition fingerprint re-verified per call)                                                                                    | `src/app/api/mcp/*`, `src/components/connections/`                                                      |
| Connectors: GitHub, Vercel, Neon, Supabase (PAT verified → AES-256-GCM sealed)                                                                                               | `src/lib/connectors/`, `src/app/api/connectors/`                                                        |
| Memory (MemoryOS: episodic/semantic/procedural/strategic), tenant-scoped                                                                                                     | `src/lib/memory/`, conflict-resolution API                                                              |
| Scheduler, automations, signed webhooks (HMAC)                                                                                                                               | `src/app/api/scheduler/tick`, `src/app/api/webhooks/*`                                                  |
| Attachments (magic-byte sniffing, 10MB cap, PDF/CSV/JSON parsing)                                                                                                            | `src/lib/attachments/`, `src/app/api/attachments/`                                                      |
| Screenshots / computer use                                                                                                                                                   | `src/lib/computer/` (M50, tested)                                                                       |
| Intelligence plane (Foundry/RSI/pulse)                                                                                                                                       | `src/lib/intelligence/`, `osirus_intel` schema (28 tables)                                              |
| Auth (Neon Auth 0.5.0-beta, email/password + GitHub OAuth, fail-closed cookie secret)                                                                                        | `src/lib/auth/`, `src/proxy.ts`                                                                         |
| Tenant isolation (RLS 81 tables FORCED, `osirus_app` NOBYPASSRLS per transaction, function EXECUTE locked down)                                                              | migrations 004/007/020, production-verified above                                                       |
| ChatHub product surface (SSE streaming, run controls, markdown, approvals UX)                                                                                                | `src/components/chat/`, `src/components/composer/`                                                      |
| Ops UIs: inbox, audit, quality, automations, connections, settings                                                                                                           | `src/app/app/*`                                                                                         |
| Landing page (CSS-only animation system, reduced-motion safe) + SEO (robots.ts, sitemap.ts, OG/Twitter, JSON-LD, icon)                                                       | `src/app/page.tsx`, `src/styles/landing.css`, PR #40                                                    |
| Legal pages: Impressum (§ 5 DDG), Privacy (GDPR), Terms — with operator placeholders                                                                                         | `src/app/legal/*`, PR #39                                                                               |
| Test infrastructure: 83 unit files (PGlite real Postgres), e2e (a11y/keyboard/responsive/performance/visual/smoke/journeys), e2e-prod, eval suites (arena/foundry/rouge/rsi) | `tests/`, `e2e/`, `e2e-prod/`, `evals/`                                                                 |
| CI: 11 workflows, OIDC-to-production, no `pull_request_target`, no event interpolation                                                                                       | `.github/workflows/`                                                                                    |
| Entitlements skeleton with enforced plan limits (free/team/enterprise)                                                                                                       | `src/lib/entitlements/`                                                                                 |

## B. PARTIALLY IMPLEMENTED

| Area                                             | State                                                                         | Gap                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Conversation management                          | pin/unpin via `PATCH /api/sessions/[id]` (zod-validated); delete exists in UI | **no rename, no archive** (no API fields, no UI); conversation search partial                             |
| Usage display                                    | usage recorded in ledger                                                      | **no user-facing usage meter / quota UI** (Phase E)                                                       |
| Billing/entitlements                             | limits enforced at creation points                                            | no payment provider; plans are free/team/enterprise — spec § 9 wants STARTER/DEVELOPER/STARTUP via Stripe |
| Memory retrieval                                 | lexical JSONB                                                                 | no vector search (documented, deliberate for now)                                                         |
| Attachments                                      | stored + parsed                                                               | images stored but not model-read                                                                          |
| Telemetry                                        | structured JSON console logger                                                | no APM/OTel; insufficient for AI-lab observability (spec § 17)                                            |
| Mode selection (research/coding/reasoning/agent) | arm routing exists internally                                                 | not exposed as explicit user-facing mode control                                                          |
| Model indicator                                  | model status table in settings                                                | no per-message model/usage indicator in chat                                                              |
| Landing page                                     | complete per Phase K checklist                                                | OG image asset missing (deferred, optional)                                                               |
| Mobile/responsive                                | e2e responsive + a11y suites exist                                            | production-verified mobile pass pending deployed run                                                      |

## C. MISSING

| Capability                                                                                   | Spec ref             |
| -------------------------------------------------------------------------------------------- | -------------------- |
| Stripe billing: checkout, portal, webhook verification, subscription lifecycle, grace period | § 9 (Phase E)        |
| Credit system: transactional ledger, reservations, settlement, refunds, hard ceiling         | § 10 (Phase E)       |
| Weekly quota subsystem (deterministic reset, concurrency-safe)                               | § 11 (Phase E)       |
| `/legal/cookies` page + footer link                                                          | § 7 (Phase D)        |
| Email sending (transactional)                                                                | prior audit          |
| Workbench Files/Diff/Terminal/Preview panels                                                 | README admits        |
| `ModelBackend` abstraction (NativeCheckpoint/LocalInference/RemoteInference/APIProvider)     | § 20 (Phase G/I)     |
| `ai-lab/` structure, dataset/checkpoint/experiment registries                                | § 18/22 (Phases G–H) |
| RunPod/H200 provisioning adapter, budget ceiling, auto-shutdown                              | § 23 (Phase K)       |
| Web-search path verification/hardening (citations, injection resistance)                     | § 15                 |
| OG social image (static 1200×630)                                                            | optional             |

## D. BROKEN

None detected in this pass: full unit gate green (985/985), static pass clean, all 40 API routes and 17 pages enumerated with guards intact, `ui-fixtures` verified unreachable in production (`fixturesEnabled()` requires `OSIRUS_UI_FIXTURES=1` **and** non-production `VERCEL_ENV`). E2E suites were not executed here (require deployed URL/browser); production OAuth flow remains to be re-verified on the deployed URL as part of Phase F.

## E. INSECURE (open)

| ID           | Severity                    | State                                                                                                                                                                                                                                                |
| ------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-1         | HIGH (residual, documented) | Tenant identity relies on per-transaction GUCs + app always assuming `osirus_app`; no in-Postgres primitive can fully close this while Neon owner holds BYPASSRLS. Mitigations in place (020 lockdown, helper-only entry points). Accepted residual. |
| Repo hygiene | MEDIUM                      | `main` unprotected (no required PR/CI); 37 merged/dead branches still present; stale branch triggers in `sync-runtime-configuration.yml`/`foundry.yml`/`live-evals.yml` until CI patch applied                                                       |
| CI hardening | MEDIUM                      | `docs/security/ci-workflow-hardening.patch` unapplied (token lacks `workflow` scope) — operator gate                                                                                                                                                 |

All Phase F code-level findings (AUTH-1/2/3/4, CONN-1, DB-2, DB-4) remain CLOSED with regression tests green in this audit's run.

## F. DUPLICATED

| Item                                                              | Note                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/runtime/router.ts` vs `router-v2.ts`                     | Two routers in different layers (regex dispatch vs arm scoring). Consolidation candidate, Phase B/C — only with tests proving parity. |
| `src/lib/skills/capability-pack.ts` (555KB generated, checked in) | Generated artifact in VCS; consider build-time generation.                                                                            |

## G. DEPRECATED

| Item                                                                                                                 | Action                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 34 pre-takeover `build/*`/`fix/*`/`integration`/`claude/*`/`rouge/m56-*` branches                                    | Fully merged → delete (operator gate; safe — deleting also kills stale push triggers) |
| `security/phase-f-20261001`, `legal/phase-i-20261001`, `product/landing-seo-20261002`, `docs/certification-20261002` | This program's merged branches → delete                                               |
| `rouge/m57-kernel`                                                                                                   | Superseded by `rouge/m57-gate` (merge candidate)                                      |

## H. PRODUCTION-BLOCKING (soft launch)

1. **12 legal operator inputs** (`docs/LEGAL_STATUS.md` § 3) — DRAFT banners stay until filled + counsel review.
2. **Branch protection on `main`** absent.
3. **CI hardening patch** unapplied + repo variables `VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` unset.
4. Neon console: IP allowlist, protected branch, PITR retention.

(The product deploys and runs today; these gate the _certified_ soft launch.)

## I. AI-INFRASTRUCTURE-READY (System B plug-in points, verified)

| Asset                                                                                                                             | Reuse for Rouge/Quesnir/Darus                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Verification engine (deterministic arbitration)                                                                                   | benchmark/run grading                                       |
| Eval spine (`evals/`, capability pulse, Foundry arenas)                                                                           | Rouge eval harness                                          |
| `src/lib/arms/base.ts` shared agent runtime                                                                                       | agent-execution evaluation substrate                        |
| UnoRouter abstraction                                                                                                             | template for `ModelBackend` (API fallback leg already real) |
| Entitlements + usage ledger                                                                                                       | credit-system extension point (Phase E)                     |
| Migration-ledger pattern (sha256, idempotent)                                                                                     | dataset/checkpoint/experiment registry pattern              |
| SCP `model/` (external repo): Llama-family transformer, BPE, memmap corpus, bf16 trainer + checkpoint/resume, distillation client | seed training stack (Phase H reuse matrix)                  |

## J. REQUIRES OPERATOR INPUT

1. 12 legal fields (address, phone, legal form, register, VAT/W-IdNr, VSBG confirmation, retention periods, provider naming, DPAs, counsel review).
2. Vercel repo variables + `workflow`-scoped token application of the CI patch.
3. Neon console settings (IP allowlist / protected branch / PITR).
4. Stripe account, keys, price IDs, portal configuration (Phase E).
5. OG image asset decision.
6. Branch-deletion execution (or delegation).
7. Explicit written authorization before any GPU spend (TRAINING_READY gate, spec § 24).

---

_Next per spec § 33: Phase B (Osirus Bot product completion) → Phase C (red-team round 2) → Phase D (legal completion) → Phase E (Stripe + credits + quotas)._
