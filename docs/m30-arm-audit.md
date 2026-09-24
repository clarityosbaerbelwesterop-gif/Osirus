# M30.1 — Arm audit

Audit of what each arm actually does on `main` after the M30.3–M30.4 changes in this PR. This is a reading of `src/lib/arms`, the shared loop in `src/lib/agent/loop.ts`, and the tools those arms register. It is not a list of class names.

There is no Computer arm. `computer_use` routes to coding (`src/lib/runtime/router-v2.ts`). Browser use is `computer.inspect` plus `SandboxBrowser`, and only when a coding or building workspace is open.

Shared loop, every arm that calls `loopAnswer` (`BaseArm.useAgentLoop` defaults to true):

- The model emits one JSON action per turn: tool, memory, replan, verify, finish, yield, and the other actions in `decision.ts`. The summary is stored. There is no field for chain-of-thought.
- Observations are labelled as data and only the last six are repeated in the prompt.
- Bounds stop the loop (steps, model calls, tool calls, wall clock, consecutive failures). Coding yields on wall clock and resumes from `LoopState`, which now includes `TaskState` on `kernel`.
- Automatic replan: at most twice per stage, when `detectReplanTrigger` sees a repeated failure, a repeated diagnostic, a missing tool, or budget risk. The revision is appended; it does not overwrite the plan store.
- Repair: `repairStrategy` sends the answer stage back once or twice when a required check failed. It does not repair from inside the model’s own claim that it is done.
- `FINISH` ends the loop. The loop does not refuse a finish that skipped verification. The M30.2 baseline measures that as false completion.

Tools every looping arm can be offered (`buildToolbox`): `memory.search`, `compute.run`, `data.analyze`, and, when a database is present, `world.query`, attachment search, reviewed MCP tools, and connected platform tools. Arena runs skip the database-backed tools.

## Thinking

What it does: one structured analysis call (`taskAnalysisSchema`), then a plan at a chosen depth. `direct` skips the planning call. `standard` is one planning call. `deep` is a critic plus one revision, both stored as plan revisions. The answer stage is the shared agent loop. The verifier checks that a plan graph, when present, is structurally valid and that serious critic objections were answered. It does not check that the world matches the plan.

Tools: the shared toolbox only. No workspace, no browser, no research fetch, unless an MCP tool was enabled for the workspace.

Iterate: yes, in the answer loop (default 12 steps). The analyse and model-plan stages are one or two model calls, not a loop.

Observations: yes, inside the answer loop. The analysis stage does not read tool observations; it has not called tools.

Hypotheses: assumptions on the task model are seeded as hypotheses with the assumption’s check stored as a falsifier. A VERIFY result updates only hypotheses it names or whose statement or falsifier the evidence actually matches (M30.4). Before this PR, one verified or rejected result marked every open hypothesis.

Replan: yes, via the loop and the automatic checkpoint trigger.

Verify: structure and plan checks. Not an external outcome.

Repair: the shared answer-stage repair.

Remember: the retrieve-memory stage, `memory.search`, and `RETRIEVE_MEMORY`. Retrieved text is now also copied into `TaskState.knownFacts` for the next slice. That is not a memory operating system.

External state: none. It writes plan revisions and an analysis object on the run.

## General

What it does: the fallback. `canHandle` is a flat 0.15 so routing always has an answer. Workflow is understand → retrieve memory → select skills → plan → answer loop → verify. Directives tell it to answer the likely reading and name the assumption. Verification is the shared structure, secret-leak, and model-review checks, plus the contract check when this arm is the meta-verifier of a composed run.

Tools: shared toolbox only.

Iterate, observations, hypotheses, replan, repair, memory: the shared loop, as above. It does not specialise them.

External state: none, unless a registered MCP or platform tool is invoked and approved.

## Coding

What it does: opens a sandbox workspace when one is configured, then the answer loop gets the repository as tools. After the loop, `run-checks` runs the repository’s commands and, on a Foundry trial, restores hidden tests and runs them. The workspace is stopped before verify. If no sandbox is configured, the stage completes with a failed workspace, the loop answers without repository tools, and test/build checks stay inconclusive. The verdict is unverified. The directives tell the model to inspect before editing, to prefer `workspace.replace`, to rerun a failed command, and not to claim a passing test without an exit code 0 in the observations.

Tools, when a workspace is open: `workspace.tree`, `workspace.read`, `workspace.search`, `workspace.write`, `workspace.replace`, `workspace.delete`, `workspace.rename`, `workspace.diff`, `workspace.commands`, `workspace.run`, `workspace.analyze_failure`, `git.deliver` (approval), `computer.inspect`, plus the shared toolbox.

Iterate: yes. Bounds are 30 steps, 32 model calls, 28 tool calls, yield on the slice wall clock.

Observations: yes. Check output is a tool result, not a trusted instruction.

Hypotheses: the directives say to form one before editing. The loop kernel records hypotheses the task model seeded and any the automatic replan adds. The coding arm does not itself score a patch hypothesis against the test output; the later check stage does that with exit codes.

Replan and repair: shared loop, plus the check stage’s evidence. A failed command does not by itself edit the file.

Verify: exit codes, diff, and the absence of a claim that tests passed when they did not. Hidden tests, when present, are the judge.

Remember: shared memory stages only. It does not keep a project model beyond the workspace record and `world.query`.

External state: the sandbox filesystem, and, if the objective asks and approval is granted, a GitHub pull request. `computer.inspect` drives a browser inside that sandbox against localhost only.

## Research

What it does: plans subquestions and counter-queries, then three gather workers run in parallel (official, independent, counter). Each worker is an agent loop over `research.search` and `research.fetch`. A search hit is not evidence. Only a fetched document enters the evidence store. Synthesis must quote verbatim excerpts. The citation verifier accepts or rejects each claim. The user-facing answer is rendered from claims that survived that check, and a real disagreement is supposed to stay visible. If nothing was fetched, the source check is inconclusive rather than a pass.

Tools: `research.search`, `research.fetch`, and the shared toolbox inside each gather loop. Search providers that are not configured are absent.

Iterate: yes, per worker (10 steps, 8 tool calls). Synthesis is one structured call, not a loop.

Observations: yes, inside each worker. The synthesis stage sees stored documents, not the worker transcript.

Hypotheses: research claims are a separate record (statement, support excerpts, contradict excerpts, verifier status). They are not the loop’s `TaskHypothesis` list. Gather loops now also carry a `TaskState`, but this arm does not yet connect a citation verdict to those hypotheses. M30.4 changes the loop helper the workers use; it does not replace the citation verifier.

Replan: shared loop inside a worker. The research plan itself is one shot, with a fallback plan if the model call fails.

Verify: citation coverage, fraction of claims backed by excerpts, source diversity.

Repair: shared answer repair does not apply to the synthesis stage in the same way; a rejected citation is dropped from the rendered answer rather than patched by a second prose pass.

Remember: shared memory retrieval before the plan. Documents live in the evidence store for the run.

External state: network fetch of sources. It does not edit a repository.

## Math / science

What it does: the answer loop is instructed to call `compute.run` for every number, `data.analyze` for tables, and to end with a `Result:` line. The verifier recomputes simple two-operand arithmetic in the answer, checks that the `Result:` line matches a `compute.run` record (`computeEvidenceCheck`), and fails the answer if it claims a formally verified proof. An expression with only mathjs available is accepted with an explicit note that no second method confirmed it. A number that no computation produced fails.

Tools: `compute.run` (mathjs in-process, plus a sandboxed Python/sympy provider when a sandbox exists) and `data.analyze`, plus the shared toolbox.

Iterate and observations: the shared loop. The interesting observation is the tool’s value and its cross-check.

Hypotheses, replan, repair, memory: shared loop. The arm does not keep a derivation tree beyond the steps and the compute evidence.

External state: the Python sandbox when configured. mathjs does not leave the process. It does not browse or edit a repo.

## Building

What it does: two modes, chosen from the objective. A product build (`isProductBuild`) writes a `BuildContract` (screens, flows, states, responsive widths), then uses the coding workspace to build it, serves it, and runs browser QA against the contract’s own selectors and texts. Verification fails a product answer that has no diff and no QA report. A document deliverable skips the workspace: the design stage stores an outline from the success criteria, and verification checks structure and outline coverage.

Tools: product mode gets the coding workspace tools and `computer.inspect`. Document mode gets the shared toolbox.

Iterate: product mode uses the coding loop bounds. Document mode uses the default loop.

Observations: QA is a report (`reportFrom` / browser session), not the model’s description of the page.

Hypotheses, replan, repair, memory: shared, plus the contract as the thing later checks are about.

External state: the workspace and a browser inside the sandbox for product QA. Document mode does not.

## Computer (capability, not an arm)

What it does: `computer.inspect` opens a page on localhost inside the workspace sandbox, performs up to ten typed actions (click, fill, press, wait), and returns status, console errors, failed requests, action results, visible text, accessibility counts, and horizontal overflow at desktop, iPad, and phone widths. `reportFrom` turns that session into checks. It cannot browse the public internet. The first use in a VM installs playwright-core and a Chromium build; that install is not part of this audit’s offline run.

Tools: the one tool above, offered to coding and building only when a workspace handle exists.

Iterate: the coding loop can call it more than once. The tool itself is one session.

Observations: the session is the observation.

Hypotheses / replan / repair / memory: only whatever the coding or building loop already does around the call. There is no computer-specific hypothesis or repair policy. A failed click is data for the next decision; nothing automatically retries the selector.

Verify: QA checks. Building’s product verifier requires them. A coding answer can still finish without calling the tool.

External state: the page under test in the sandbox. Screenshots stay in the workspace.

## Memory (capability, not an arm)

What it does today: a retrieve stage, `memory.search`, and the `RETRIEVE_MEMORY` action. Compiler v2 keeps an unverified outcome in working memory and does not promote it. Follow-up quality is whatever retrieval returns for the new query.

What this PR adds: retrieved items are copied into `TaskState.knownFacts` on the loop checkpoint, so the next slice sees them as structured facts. That does not search prior projects on its own, does not resolve contradictions in memory, and is not M31.

External state: the memory tables for the workspace, when a database is configured.

## What this audit is not

PRs #9–#12 (dataset verify, model-candidate honesty, budget and checkpoint atomicity, attempt accounting, train-set near-duplicates) are still in the tree. They are not this audit and they are not an intelligence director. M31–M34 are deferred; see `docs/m31-m34-deferred.md`.
