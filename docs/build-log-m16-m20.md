# Build log — M16 → M20 (productization)

Branch `build/m16-m20-productization`, started from `main` at `4dec2ce`.

## Design skills used while building

The design assistants were installed for the build environment only. Nothing
was added to Osirus' dependencies to make them available.

| Skill                                                                                                                  | Source                                      | How it was installed                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ui-ux-pro-max 2.15.0 (+ 6 companion skills: design, design-system, ui-styling, brand, banner-design, slides)           | npm `ui-ux-pro-max-cli@2.15.0`              | `npm i -g ui-ux-pro-max-cli@2.15.0`, then `uipro init --ai claude --global` into `~/.claude/skills/`                                                                 |
| ui-skills: baseline-ui, fixing-accessibility, fixing-motion-performance, improve-ui, create-design-md, fixing-metadata | `github.com/ibelick/ui-skills` at `fd0889b` | The ui-skills.com registry answered 403 from the build sandbox, so the first-party skills were copied from a clone of the GitHub repository into `~/.claude/skills/` |

They were applied as review checklists (accessibility, touch targets, focus,
motion, contrast, layout, forms, empty states) during implementation and in the
design review loop below.

## Design review loop (before the pull request)

Every surface was rendered from `/ui-fixtures/*` (real components, fixture
data) at 375, 768, 1024 and 1440 px in light and dark, inspected, and audited
with axe. The ten worst problems found, all fixed and re-inspected:

1. **GitHub chip claimed "Connect GitHub" while connected.** The status request
   aborted itself: recording "requested" in state re-ran the effect, whose
   cleanup aborted the fetch, and the abort fell through to "unknown". Found by
   journey 3; the flag is now a ref and aborts are ignored.
2. **Light-theme success text below 4.5:1** (badges, diff additions). Success
   token darkened to `#065f46`; axe clean in both themes.
3. **Code, diff and terminal panes unreachable by keyboard.** Scrollable `pre`
   blocks are now focusable, labelled regions.
4. **Settings navigation on phones scrolled sideways and hid the current
   section.** It now wraps into chips; every section stays visible.
5. **Autonomy policy table unreadable on phones.** Rows stack under 600 px.
6. **Markdown tables broke words mid-token** ("pgvect/or"). Cells keep words
   whole; the table scrolls inside its frame.
7. **MCP "Add server" form had no way out.** Cancel added.
8. **"New automation" sat below every automation.** It is the page's primary
   action at the top now.
9. **Window splitter showed no focus ring**, and the latest terminal output
   was collapsed. Ring added; the most recent command opens by default.
10. **Top bar and sidebar truncation on phones** (title cut to a few letters,
    session titles overflowing). The theme menu moves off the phone top bar,
    the status badge hides under 480 px, sidebar rows shrink correctly.

Also changed in the loop: the floor note reads "Never runs without asking";
preset cards align to the top; connection health columns fit at 1024 px; every
relative time is a `<time datetime>` element.

## Quality bar

- Unit and integration: `vitest` (29 files), including the attack suite,
  policy floors, MCP client and SSRF guard, regression gate and automations.
- Playwright projects (`playwright.config.ts`):
  - `smoke` — real sign-in page, health endpoint without secrets.
  - `visual` — 11 screenshots: empty ChatHub (desktop), active run, research
    run with sources, coding workbench, approval card, connections, settings,
    automations, tablet, phone, phone dark. Baselines are rendered by the CI
    browser (`.github/workflows/visual-baselines.yml`) and compared on every CI
    run; clock-dependent text is hidden by `e2e/screenshot.css`.
  - `ui` — no horizontal overflow on 9 surfaces at 4 widths; keyboard (skip
    link, focus ring on every tab stop, Enter/Shift+Enter, tab arrow keys,
    splitter, sheet Escape with focus return); axe WCAG 2.2 A/AA on 9 surfaces
    in both themes plus the phone drawer (serious/critical fail the build);
    user journeys 1–6.
- CI uploads the Playwright report, the compared baselines and, on failure,
  actual/diff images and traces as the `playwright-evidence` artifact.

## Performance

`e2e/performance.spec.ts` runs on the production build and fails the build past
its budgets: CLS < 0.1, LCP < 2.5 s (local server), compressed JavaScript
< 350 KB per surface. Measured before the pull request:

| Surface     | CLS   | LCP    | JS (compressed) |
| ----------- | ----- | ------ | --------------- |
| Empty chat  | 0.000 | 260 ms | 247 KB          |
| Coding run  | 0.002 | 236 ms | 292 KB          |
| Connections | 0.000 | 208 ms | 247 KB          |

The Markdown pipeline (micromark, GFM, hast; about 60 KB compressed) loads
with the first answer instead of with the empty chat, and the workspace and
research panels load when their tab opens.

Visual baselines: rendered by the CI browser in the `Visual baselines`
workflow, run 35885165364 (commit `80362cd`), then inspected before the pull
request.

## Migration 011

`db/migrations/011_productization.sql` is additive (new tables, nullable
columns), so it was applied before the merge; the deployed code ignores what
it does not use. 000–010 are untouched.

1. Disposable branch `br-curly-glitter-b2pt4hu1`: 49 statements plus ledger
   row in one transaction. Every osirus table has RLS enabled and forced; the
   seven new tables carry 11 policies; `osirus_app` has no UPDATE or DELETE on
   `security_events` and `connector_health`.
2. Cross-tenant probe on that branch (seeded as the system, run through
   `osirus_app`, rolled back): a non-member sees 0 rows in all seven tables and
   is refused (42501) inserting an MCP server, a notification for someone
   else, or a security event; the member sees 1 row each, cannot rewrite a
   security event or delete a health check (42501); an MCP tool with risk
   `low` or enabled without review is rejected by CHECK (23514).
3. Production `br-ancient-sunset-b2d9pasu`: same transaction, ledger row
   `011_productization.sql` (checksum `4ad13f05…`, 49 statements). Tables
   without forced RLS: 0. `/api/health` stayed `ok` on the running
   deployment.
