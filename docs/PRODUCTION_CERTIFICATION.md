# OSIRUS — Production Certification v2

Date: 2026-10-02 · Ref: `main` @ `6f4d7922091bbf0c5b526dc9e2a323693c63e742` (post PR #49) · Method: fresh codeload tarball of the certified ref; full-tree re-read of the audit corpus; quality gate re-run in the extracted tree (`tsc`, `prettier`, `eslint`, `vitest`); production evidence carried from `docs/OSIRUS_MASTER_AUDIT.md` (PR #42, Neon catalog inspection). Every number below is stated exactly as verified in the cited source or re-measured in this pass. Supersedes the v1 certification (Phase F); v1's structure is retained, its content is updated to the post-#49 facts.

## 1. Certification statement and scope

**Certified: the Osirus product platform as shipped on `main` @ `6f4d7922`, excluding the billing surface.** Build, type safety, tests, tenant isolation, auth, security posture, legal scaffolding, and the product surface are certified for soft launch, conditioned on the open operator actions in § 6.

**Explicitly not certified (out of scope, not a defect):** Stripe checkout, the credit system, and weekly quotas. Per owner decision of 2026-10-02, billing is deferred to the end of the program (Phase E last). This is a planned extension area, not a shipped surface with known gaps — but it is a **non-certified area**: no claim in this document covers payment flows, entitlement races under payment, webhook verification for a payment provider, or the legal updates that must ship with them. Terms and privacy pages truthfully state that no payment provider is integrated.

## 2. Verified measurements

| Measurement                            | Value                                                          | Source                                                                |
| -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Certified ref                          | `main` @ `6f4d7922091bbf0c5b526dc9e2a323693c63e742` (post #49) | merge ledger                                                          |
| Unit tests                             | **1021 passed, 2 skipped** (1023 total)                        | `vitest run` in this pass (135 s)                                     |
| Unit test files                        | 88 passed, 1 skipped (89)                                      | `vitest run` in this pass                                             |
| `tsc --noEmit`                         | clean                                                          | gate run in this pass                                                 |
| `prettier --check` / `eslint`          | clean                                                          | gate run in this pass                                                 |
| DB migrations (files)                  | 21 (`db/migrations/000`–`020`)                                 | tree enumeration                                                      |
| DB migrations (applied, production)    | 21, latest `020`                                               | `osirus.schema_migrations` ledger (master audit, PR #42)              |
| Tables with RLS ENABLED + FORCED       | **81** (schemas `osirus` + `osirus_intel`)                     | `pg_class` (master audit, PR #42)                                     |
| RLS policies                           | **143** (88 `osirus` + 55 `osirus_intel`)                      | `pg_policy` (master audit, PR #42; supersedes the "180" figure in v1) |
| Functions with residual PUBLIC EXECUTE | **0** (all 18 in both schemas)                                 | `pg_proc.proacl` inspection (master audit, PR #42)                    |
| App pages / API routes                 | 17 `page.tsx` / 40 `route.ts`                                  | master audit, PR #42                                                  |

## 3. Security posture

Red-team round 2 (`docs/SECURITY_REDTEAM.md`, PR #48; base commit post-#47, static analysis of all eight attack surfaces): **0 CRITICAL, 0 HIGH, 2 MEDIUM, 7 LOW, 5 INFO**. No remotely exploitable tenant-isolation breach, auth bypass, or injection path was found.

**Fix status (PR #49, this certification re-verified the code and tests):**

- **RT2-01 (MEDIUM, CLOSED):** automation budget upsert no longer clears default run ceilings; `startAutomationRun` spreads `...DEFAULT_RUN_BUDGET` under the automation-specific ceilings (`src/lib/automations/store.ts`). Regression test: `tests/automation-budget.test.ts`.
- **RT2-02 (MEDIUM, CLOSED):** research fetcher now routes through the connect-time-guarded undici dispatcher (`guardedLookup`), closing the DNS-rebinding TOCTOU window (`src/lib/research/fetch.ts`). Regression test: `tests/research-fetch-rebinding.test.ts`.
- **DB-1 (residual HIGH, confirmed unchanged, accepted):** tenant identity rides on transaction-local GUCs under the shared `osirus_app` role; no in-Postgres primitive closes this while the Neon owner holds BYPASSRLS. Re-assessed in round 2: all application SQL parameterized, `queryAs`/`querySystem` the only tenant-data entry points, `osirus_app` NOLOGIN, migration 020 revoked PUBLIC EXECUTE on all 18 functions. Standing accepted residual, documented in `docs/OSIRUS_MASTER_AUDIT.md` § E.
- Phase F findings (AUTH-1/2/3/4, CONN-1, DB-2, DB-4) remain CLOSED with regression tests green.
- CI hardening patch (`docs/security/ci-workflow-hardening.patch`) is prepared and covers RT2-03/RT2-04/RT2-10; it is **unapplied** — push is blocked by a missing `workflow` OAuth scope (owner action, § 6).

## 4. Product surface status

Shipped since the master audit (PRs #43–#46):

- **B1 (PR #43):** session rename/archive via workspace-scoped `PATCH /api/sessions/[sessionId]` (zod-validated `title` / `archived` fields).
- **B2a (PR #44):** explicit mode selection with an honest routing bias — bounded `MODE_BOOST = 0.5`, capped at 1.0, persisted in the run's `reason` (`src/lib/runtime/router-v2.ts`). No hidden routing claims.
- **D (PR #45):** `/legal/cookies` page with the § 25 Abs. 2 TDDDG inventory (strictly-necessary and requested storage only, hence no consent banner required); remaining `[[OPERATOR: …]]` placeholders are deliberate markers per `docs/LEGAL_STATUS.md`.
- **B2b (PR #46):** per-message model indicator in chat (`modelCaption` in `src/components/chat/message-list.tsx`) showing the model a run answered with, plus token spend when known.

Billing, usage meter, and quota UI remain unbuilt by owner decision (§ 1). OG image remains a deferred optional asset.

## 5. AI-program gate status

**TRAINING_READY = FALSE.** Preconditions per the master spec require, among others, billing and observability; billing is absent (owner-deferred to Phase E) and observability is PARTIAL (structured JSON console logger only, no APM/OTel). The "billing ready" checkbox of the training gate is **blocked-by-owner-deferral**, not failed.

Consequences, per `docs/ROUGE_RESEARCH_HANDOFF.md` (PR #47): no Rouge/Quesnir/Darus code merges into `main`; no GPU spend without TRAINING_READY=TRUE plus explicit owner authorization; no fabricated training/benchmark/capability claims. `docs/AI_LAB_DEEPSEEK_REUSE.md` (PR #47) records the reuse analysis for the research program — documentation only, zero spend, zero training; critically, it corrects that the DeepSeek 2T-token corpus is not public and can never be claimed as a provenance source.

## 6. Open operator actions

1. **Apply the CI hardening patch** (closes RT2-03 missing workflow `permissions:` block, RT2-04 stale dead-branch push triggers on secret-holding workflows): requires a token with `workflow` scope — owner.
2. **Create repo variables** `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` (RT2-10; part of the same patch) — owner.
3. **P2 hardening backlog:** RT2-05 (nonce-based production `script-src`), RT2-06 (operator-gate the detailed readiness payload), RT2-09 (normalize auth error text; confirm provider-side throttling). Lower-priority items RT2-07/08/11/13/14 are documented in `docs/SECURITY_REDTEAM.md`.
4. **12 legal operator inputs** (`docs/LEGAL_STATUS.md` § 3: address, phone, contact confirmation, legal form, register, VAT/W-IdNr, VSBG statement, MStV check, retention periods, provider naming, DPAs, counsel review); DRAFT banners stay until filled and reviewed.
5. **DB-1 residual HIGH** — standing accepted risk; no action possible in Postgres, but any change to the DB topology reopens it.
6. **Neon console hardening:** IP allowlist, protected branch, raise PITR retention — owner.
7. **Branch hygiene:** delete the 37+ stale/merged branches identified in the master audit (also removes the stale push triggers behind RT2-04); enable branch protection on `main` — owner.
8. **OG image** (optional, deferred): static 1200×630 social card.

## 7. Recertification triggers

A v3 certification is required when any of the following lands:

1. **Phase E (billing):** Stripe checkout/portal/webhooks, credit ledger, quotas — the entire billing surface is currently non-certified (§ 1).
2. **Landing of the CI hardening patch** (RT2-03/RT2-04/RT2-10) or any workflow change touching secrets.
3. Any change to tenant-isolation mechanics (`queryAs`, `osirus_app` role, RLS policies, migration 021+) — reopens DB-1 assessment.
4. Any new external provider integration (payment, email, analytics, tracking) — includes a mandatory privacy/cookies re-review per `docs/LEGAL_STATUS.md` § 4.
5. Any Rouge/Quesnir/Darus research work approaching `main`, or any request to flip TRAINING_READY.
6. Six months from this certification date, whichever comes first.
