# OSIRUS — Project State (verified against code, not docs)

Audit date: 2026-10-01 · Audited ref: `main` @ `716f1f7` · Method: full tree enumeration + direct file reads + Neon DB catalog inspection (GitHub code search is **not indexing this repo**, so all "absent" claims were verified by enumeration).

## 0. Verdict

OSIRUS is a **genuinely implemented, unusually disciplined codebase** — not vaporware and not an LLM wrapper. Nearly every subsystem maps to substantial real code with tests (77 unit test files running against real Postgres via PGlite, plus e2e and production journey suites).

**Headline gaps (honest list):**

1. **No billing/payment provider** — entitlements + usage ledger exist; zero Stripe (`src/lib/entitlements/index.ts` comment: "There is no billing behind this").
2. **No email sending** — in-app notifications only.
3. **No vector search** — memory is JSONB lexical (README admits this).
4. **Workbench Files/Diff/Terminal/Preview panels not built** — only research/run/workspace panels exist (README admits).
5. **Rouge roadmap M59–M75 is DOC-ONLY** — M56–M57 exist as code; M61 memory / M63 verifier / M74–M75 cost ceilings are not implemented.
6. **Duplicate `proxy.ts`** at repo root (dead but dangerous, see AUTH-2 in SECURITY_AUDIT.md).
7. **`.env.example` drift** — ~8 env vars read by code are undocumented (incl. `OSIRUS_CONNECTOR_KEY`, so fresh deploys silently disable all connections).

## 1. Stack

| Layer      | Reality                                                                                                                                                                                               | Evidence                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Framework  | Next.js 16, React 19, TS strict, App Router, typedRoutes                                                                                                                                              | `package.json`, `next.config.ts`                        |
| DB         | Neon Postgres 18 (eu-central-1), **no ORM** — raw SQL via `@neondatabase/serverless`; 20 migrations `db/migrations/000–019`; RLS enforced via non-BYPASSRLS role `osirus_app` assumed per transaction | `src/lib/db/client.ts`, `scripts/apply-migrations.mjs`  |
| Auth       | Neon Auth `@neondatabase/auth@0.5.0-beta` (Better Auth-based); email/password + GitHub OAuth                                                                                                          | `src/lib/auth/server.ts`, `src/proxy.ts`                |
| Models     | "UnoRouter" = one OpenAI-compatible endpoint, ≤3 keys, free-model-first with live pool discovery from `GET /v1/models`                                                                                | `src/lib/models/unorouter.ts`, `free-registry.ts`       |
| Sandbox    | `@vercel/sandbox` over OIDC, deny-all network by default; degrades honestly (inconclusive→unverified) outside Vercel                                                                                  | `src/lib/sandbox/vercel.ts`                             |
| Deployment | Vercel, production at **https://osirus.vercel.app**; daily Vercel cron + hourly GitHub-Actions OIDC tick                                                                                              | `vercel.json`, `.github/workflows/capability-pulse.yml` |

## 2. Subsystem reality map

| Subsystem                                                               | Status                                      | Notes                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Durable runtime (DAG, leases, slices)                                   | **REAL**                                    | `claim_next_stage` SKIP LOCKED, lease-token fencing, checkpoint+budget in one transaction               |
| Agent loop (observe–decide–act–verify)                                  | **REAL**                                    | Bounded, checkpointed, replan triggers, finish gates; 21KB test file                                    |
| Agent arms (6: thinking/coding/research/math-science/building/general)  | **REAL**                                    | `src/lib/arms/base.ts` 62KB shared runtime                                                              |
| UnoRouter provider abstraction                                          | **REAL**                                    | Single provider only; anti-evasion key failover; capacity admission P0–P4                               |
| Tool registry + approval gates                                          | **REAL**                                    | Fail-closed; approvals bound to tool+exact input+MCP fingerprint, 1h expiry                             |
| MCP client + store + UI                                                 | **REAL**                                    | Streamable-HTTP, definition fingerprint re-verified before every call                                   |
| Connectors (GitHub, Vercel, Neon, Supabase)                             | **REAL**                                    | PATs verified then AES-256-GCM sealed; platforms read-only by design; GitHub writes need grant+approval |
| Memory (MemoryOS: episodic/semantic/procedural/strategic)               | **REAL, lexical**                           | No vector search                                                                                        |
| Verification engine                                                     | **REAL**                                    | MODEL-only claims cap at "unverified"                                                                   |
| Scheduler / automations / webhooks                                      | **REAL**                                    | HMAC-verified webhooks; chained ticks via `after()`                                                     |
| Attachments                                                             | **REAL**                                    | Magic-byte sniffing, 10MB cap, PDF/CSV/JSON parsing; images stored but not model-read (PARTIAL)         |
| Screenshots / computer use                                              | **REAL**                                    | M50 fix landed, tested                                                                                  |
| Intelligence plane (Foundry/RSI/pulse, `src/lib/intelligence/` 26 dirs) | **REAL code**, runs via tick/workflows only | `osirus_intel` schema, 28 tables                                                                        |
| Billing                                                                 | **PARTIAL**                                 | Limits + usage ledger enforced; no payment integration                                                  |
| Email                                                                   | **ABSENT**                                  | In-app notifications only                                                                               |
| Telemetry                                                               | **PARTIAL**                                 | 853-byte JSON console logger; no APM/OTel                                                               |
| ChatHub UI + Connections UI                                             | **REAL**                                    | SSE client; connection states incl. DEGRADED/EXPIRED, health, last-used                                 |

## 3. Database state (Neon project `super-voice-69875601`)

- Default branch `production`; DB `neondb`; schemas: `osirus` (53 tables), `osirus_intel` (28), `neon_auth` (9, managed), `public` (empty).
- **RLS: ENABLED + FORCED on all 81 app tables; 180 policies** via SECURITY DEFINER helpers with pinned `search_path`. Append-only audit pattern on `security_events`/`connector_health` (no UPDATE/DELETE for app role).
- No plaintext credential columns; `credential_reference` holds envelope-sealed (`v1.…`) references.
- 20 migrations applied in clean monotonic order with sha256 checksums.
- **Two HIGH findings at the trust boundary** (tenant identity via forgeable GUCs; enforcement depends on app always `SET ROLE osirus_app` since `neondb_owner` has BYPASSRLS) — see SECURITY_AUDIT.md DB-1/DB-2.
- Data volume is tiny (2 users, 6 sessions, 8 runs) — pre-launch state.

## 4. Branch census (38 branches)

**34 of 38 branches are fully merged into main** (14 as true ancestors, 20 via squash). Only 3 carry unmerged work:

| Branch                                                                                   | Status                                                       | Action                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `main`                                                                                   | PRODUCTION (tip `716f1f7`, 2026-09-28)                       | **Protect it** (currently zero protected branches) |
| `rouge/m57-gate`                                                                         | MERGE CANDIDATE (+1 commit: eval interleaving)               | Merge via PR after CI                              |
| `rouge/free-gpu-training-20260930`                                                       | EXPERIMENTAL (GPU training preflight)                        | Keep isolated                                      |
| `rouge/native-model-m58`                                                                 | EXPERIMENTAL (exo/MLX native model, newest work, 2026-10-01) | Keep isolated                                      |
| all `build/*`, all `fix/*`, `integration`, `claude/*`, `rouge/m56-*`, `rouge/m57-kernel` | MERGED → DEAD                                                | **Delete after removing stale workflow triggers**  |

**⚠ Stale secret-bearing triggers:** `sync-runtime-configuration.yml`, `foundry.yml`, `live-evals.yml` still fire on pushes to dead build branches. Remove those refs **before** branch deletion.

## 5. CI/CD

11 workflows. Security posture is good: no `pull_request_target`, no event interpolation into shell, OIDC-to-production (no prod secrets in GitHub), token masking, `ci.yml` uses zero secrets. Findings: `ci.yml` lacks explicit `permissions:` block; `software-rsi.yml` (executes model-generated patches) is well-hardened but has wider-than-needed `issues:write`/`actions:write`; hardcoded Vercel team/project IDs in 4 workflows. Details in SECURITY_AUDIT.md.

## 6. SCP (swarm-compute-protocol-) assessment

**Headline: SCP contains NO compute infrastructure** — no runners, no GPU orchestration, no distributed execution. The "Compute Swarm" is an in-process simulation of 10,000 RNG-synthesized nodes (flagged "erfunden" by SCP's own audit).

- **Reusable by Osirus (patterns):** LLM multi-provider failover + KeyPool 429-rotation; niveau uplift pipeline; per-user MCP client; C++ deny-by-default policy-gate architecture.
- **Reusable by Rouge:** `model/` — a real, tested single-GPU training stack (Llama-family transformer, BPE, memmap corpus pipeline, bf16 trainer with checkpoint/resume, distillation client + `distill.yml` pattern). Good seed scaffold. Missing for Rouge: DDP/FSDP, GPU provisioning, experiment tracking, artifact stores — must be built fresh.
- **Must remain separate:** SCP's commerce stack (SEPA/Stripe/tiers), OAuth, webapp/PWA/iOS, Streamlit dashboard.
- Do **not** reuse `sandbox.py` for multi-tenant execution (no network isolation; own docstring admits it is not a security boundary).

## 7. Known contradictions / drift

1. Root `proxy.ts` vs `src/proxy.ts` — duplicate auth middleware; root file is dead under Next.js `src/` resolution but would regress the OAuth login loop (issue #26) if ever activated. **Delete.**
2. Two routers live in different layers: `router.ts` (regex, used by `POST /api/runtime`) vs `router-v2.ts` (arm scoring; the one README describes).
3. README migration docs stop at 009; actual migrations run to 019.
4. `.env.example` missing: `OSIRUS_CONNECTOR_KEY`, `OSIRUS_FREE_MODEL_PRIMARY/SECONDARY/TERTIARY`, `ROUGE_CORE_MODEL`, `ROUGE_SUBSTITUTE_CORES`, `CRON_SECRET`, `OSIRUS_UI_FIXTURES`, and several tuning vars.
5. 555KB checked-in generated file `src/lib/skills/capability-pack.ts`.
6. Auth library is a beta (`@neondatabase/auth@0.5.0-beta`).

## 8. Prioritized next actions (input to Phases F–N)

| #   | Action                                                                                             | Severity/effort |
| --- | -------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Fail-closed startup when `NEON_AUTH_COOKIE_SECRET` missing; remove public fallback secret (AUTH-1) | MEDIUM / S      |
| 2   | Verify app always `SET ROLE osirus_app`; consider dedicated non-BYPASSRLS login role (DB-1/DB-2)   | HIGH / M        |
| 3   | Delete root `proxy.ts` (AUTH-2)                                                                    | LOW / XS        |
| 4   | Fix `.env.example` drift incl. `OSIRUS_CONNECTOR_KEY` (AUTH-4)                                     | LOW / XS        |
| 5   | Remove dead-branch workflow triggers; add `permissions: contents: read` to ci.yml                  | MEDIUM / XS     |
| 6   | Protect `main` (PR + CI required); enable auto-delete of merged head branches                      | MEDIUM / XS     |
| 7   | Delete 34 merged branches                                                                          | LOW / S         |
| 8   | Merge `rouge/m57-gate` via PR                                                                      | LOW / XS        |
| 9   | Neon: IP allowlist + protected branch; raise PITR retention (paid plan)                            | MEDIUM / XS     |
| 10  | Full red-team (Phase F) building on SECURITY_AUDIT.md                                              | —               |
