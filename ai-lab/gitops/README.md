# GitOps control plane — Rouge 1 · Quasnir · Darus

Date: 2026-10-05 · Status: **built and tested; gate closed (`trainingReady: false`), zero spend.**

The repository is the control plane. Every hyperparameter, pipeline, compute
request, owner authorization and measured result is a reviewed file under
`ai-lab/gitops/`. GitHub Actions only validate, plan, gate and dispatch. The
compute runs on dedicated providers (RunPod serverless, Modal) in ephemeral
workers that scale to zero, and the results come back as pull requests.

```
 iPad (GitHub app · Shortcuts · Working Copy · VS Code Web)
   │  PR: edit manifests          │  workflow_dispatch / repository_dispatch
   ▼                              ▼
 gitops-validate ──► plan     gitops-pipeline ──► gate ──► env approval (gpu-spend)
                                 │ synth (runner + Docker sandbox)   │ train / merge / eval
                                 ▼                                   ▼
                       HF dataset (private)             RunPod / Modal worker (ephemeral)
                                 │                                   │ HF model (private)
                                 └──────► gitops-record ◄────────────┘ repository_dispatch
                                           PR: state/runs/<run>.json  (merge = accept)
```

## Models

| Id          | Manifest                | What it is                                                                                    |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `rouge-1`   | `models/rouge-1.json`   | Generalist QLoRA adapter on the 27B base `google/gemma-3-27b-it`                              |
| `quasnir-1` | `models/quasnir-1.json` | Code + security QLoRA adapter on the same base, trained on the verified golden-token pipeline |
| `darus-1`   | `models/darus-1.json`   | TIES merge of both adapters (MergeKit, CPU), then evaluated separately                        |

Quasnir is the spelling used across the ai-lab code (`osirus/quasnir-1`); the
specification's "Quesnir" is the same model.

The base weights are foreign (Gemma Terms of Use). Every model card the
worker publishes says so: adapters and merges are fine-tunes of that base,
never "self-trained" models (ai-lab hard rule 4).

## Job graph and reconciliation

`synth:golden-tokens → train:quasnir-1 ┐`
`train:rouge-1 ──────────────────────┴→ merge:darus-1 → eval:darus-1`

`lib/plan.ts` hashes each job's manifest together with the exact artifact
revisions it consumes. A job is **up-to-date** only when a succeeded run
record with that hash exists. Changing a hyperparameter, a pinned revision or
a parent adapter re-plans that job and everything downstream (drift);
resource-only changes (`compute`, `concurrency`) do not. Statuses: `ready`,
`blocked` (gate), `waiting` (upstream), `up-to-date`.

Promotion (`plan.promotions`): adapters must meet their eval gates (sanity
floors, not capability claims). Darus must meet its gates **and** stay within
`maxRegressionVsParents` of the best parent on every suite, so the fusion
keeps both specialties.

## Gate (`lib/gate.ts`)

A job is dispatched only when every blocker is cleared:

- an unexpired owner authorization in `control-plane.json` scoped to the job
  and covering its worst-case cost (merged by pull request; CODEOWNERS);
- `trainingReady: true` in `control-plane.json` **and** `OSIRUS_TRAINING_READY=true`
  in the `gpu-spend` environment (the Phase K double key from `ai-lab/infra/runpod.ts`);
- budget ceilings: worst case (catalog rate × GPUs × hard runtime) per run, and
  the durable ledger of recorded `costUsd` against the total;
- the hard runtime doubles as the provider kill switch (`executionTimeout`),
  validated by `validateProvisionRequest` (≤ 24 h);
- pinned 40-hex revisions for base and datasets; approved license reviews with
  evidence; approved teacher terms for synthetic data; no `change-me` placeholders;
- hardware fit: a QLoRA VRAM floor for training/eval, RAM and disk floors for
  the bf16 merge;
- at dispatch time: provider secrets present.

## Synthetic data: the agent swarm (`lib/swarm.ts`)

Logical agents (`author`, `secure-coder`, `code-reviewer`; count × tasks per
agent) share a queue with bounded concurrency. A candidate becomes a golden
record only after, in order of cost: shape checks → 13-gram decontamination
against HumanEval/MBPP/GSM8K test rows → near-duplicate filter → unit tests
in the Docker sandbox → a **vacuity check** (the tests must fail against an
empty `solution.py`) → the process reward model threshold (min over steps).
Every rejection is counted by reason in the run summary. Records are TRL
conversational prompt/completion rows, so the loss covers the answer only.

Sandbox (`lib/sandbox.ts`): `--network none`, read-only root and mount,
`--cap-drop ALL`, `no-new-privileges`, uid 65534, memory/CPU/PID limits,
`timeout` inside and a container kill outside, image pinned by digest.

## Worker (`worker/`)

One image for RunPod serverless (`handler.py`) and Modal (`modal_app.py`):

- **train**: 4-bit nf4 base + LoRA (PEFT) with TRL `SFTTrainer`, then lm-eval on
  the declared suites, then a private Hub push. Every model in the program is
  evaluated 4-bit with the same harness settings, so the numbers compare.
- **merge**: `mergekit-yaml … --lazy-unpickle` on CPU in an isolated venv
  (MergeKit 0.1.4 pins conflict with the RunPod SDK). The rendered config uses
  `base@rev+adapter@rev`, and a post-check fails the job if an adapted tensor
  equals the base (adapters silently not applied).
- **eval**: lm-eval on the merged model.
- Every outcome, failures included, returns as a run record through
  `repository_dispatch`; secrets in error text are scrubbed.

Dependencies are pinned to sets resolved together with pip on 2026-10-05.
The pure job logic is unit tested (`test_jobs.py`); a TypeScript test runs
a rendered payload through the Python worker and validates the record it
returns. The GPU paths have not run on hardware yet: that is the first gated
run, not a claim.

## Test-time compute (`lib/mcts.ts`)

PRM-guided Monte Carlo Tree Search: the policy proposes `branching` next
steps, the PRM values each node, UCT selects. Configured in
`inference/test-time-compute.json`; the library is ready but not yet wired
into product serving.

## Corrections to the specification, with reasons

1. **Merging needs one base.** Task vectors only add up when both adapters are
   trained on the identical base and revision. The schema enforces it.
2. **The merge is CPU-only; evolutionary merge search is not.** Each candidate
   in an evolutionary search must be scored by inference. The deterministic TIES
   merge runs on CPU; `evolution.enabled` stays blocked until a GPU fitness loop
   exists.
3. **TIES, not DARE, by default:** DARE's random pruning is not seedable in
   MergeKit 0.1.4, which breaks reproducibility (TRAINING_READY box 18).
4. **No security benchmark in lm-eval.** Quasnir's security skill is trained
   (secure-coder and code-reviewer agents) but not yet measured;
   CyberSecEval-style evaluation is the open gap.
5. **GitHub runners orchestrate; they do not train.** 27B training and the
   bf16 merge (≈54 GB per copy) exceed hosted runners and are outside the
   intended Actions use. The swarm runs on the runner because it is API calls
   plus short sandboxed unit tests.
6. **Teacher terms are a gate.** Many hosted APIs forbid training competing
   models on their outputs. The default teacher is a self-hosted open-weights
   model, and its terms review is still pending.

## Operator runbook (iPad-friendly)

One-time setup (repository settings):

1. Environments: `gpu-spend` (required reviewer: owner; variable
   `OSIRUS_TRAINING_READY`; secrets `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`,
   `MODAL_JOB_URL`, `MODAL_JOB_TOKEN`) and `synthetic-data` (secrets
   `TEACHER_BASE_URL`, `TEACHER_API_KEY`, `PRM_URL`, `PRM_API_KEY`, `HF_TOKEN`).
2. Actions → "Allow GitHub Actions to create and approve pull requests".
3. Build the worker image (`gitops-worker-image`), create a RunPod serverless
   endpoint from it (env: `HF_TOKEN`, `GITHUB_DISPATCH_TOKEN` = fine-grained
   token, this repository, Contents: write; endpoint execution timeout ≥ the
   longest `maxRuntimeHours`), and/or `modal deploy ai-lab/gitops/worker/modal_app.py`.
4. Replace `change-me-hf-org`, pin the base and dataset revisions, record the
   license and teacher-terms reviews with evidence links.

Each run:

1. Pull request: add an authorization to `control-plane.json`; the
   `gitops-validate` plan shows what is still blocked.
2. Run `gitops-pipeline` with `job` and `execute` from the GitHub app, or from
   a Shortcut:

   ```sh
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     https://api.github.com/repos/clarityosbaerbelwesterop-gif/Osirus/dispatches \
     -d '{"event_type":"gitops-dispatch","client_payload":{"job":"train:rouge-1","execute":true}}'
   ```

3. Approve the `gpu-spend` deployment in the GitHub app.
4. Merge the `gitops: record …` pull request when it arrives; the next plan
   releases the downstream jobs.

Local: `npx vite-node ai-lab/gitops/cli.ts validate | plan | dispatch <job>`.
