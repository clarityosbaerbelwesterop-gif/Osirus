---
name: codex
id: codex
description: Autonomous software engineering, deep static/dynamic code analysis, deterministic verification loops, and surgical multi-file refactoring.
---

# SKILL: Codex — Autonomous Code Engineering & Verification

## Core Principles
1. **Deterministic Verification First**: Every code change must be backed by static typechecking (`tsc --noEmit`), linting (`eslint`), and automated unit/integration tests (`vitest`).
2. **Zero Placeholders / Zero Stubs**: Never ship "coming soon", placeholder arrays, or mocked production paths when real implementations are required.
3. **Transactional & Concurrency Safety**: Ensure all database operations respect Row-Level Security (`osirus_app`), atomic transactions, idempotency keys, and bounded resource consumption.
4. **Iterative Code-Test-Repair Loop**: Observe -> Plan -> Edit -> Verify -> Repair until all checks pass with zero warnings or errors.
