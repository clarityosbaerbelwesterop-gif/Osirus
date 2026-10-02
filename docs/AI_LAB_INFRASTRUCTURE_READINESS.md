# AI Lab infrastructure readiness

Date: 2026-10-02 (Europe/Berlin). Milestone: local infrastructure for Rouge, Quesnir, and Darus.

**Large-scale training was NOT started.** No GPU pod was booted. No paid RunPod or Lightning call was made. No benchmark score was measured. No checkpoint in this milestone is a trained Rouge, Quesnir, or Darus model. `TRAINING_READY` stays **FALSE**. Nothing is marked `production` or `production_candidate`.

The earlier research rule said `ai-lab/` does not merge to `main`. The owner instruction for this milestone explicitly overrides that for these infrastructure pull requests only. It does not authorize training or a production promotion.

## What already existed (reused)

| Item                                                                                                                               | Where                                                                                       | Class                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| AI Lab contracts, dataset pipeline, eval runner, JSONL registries, three model scaffolds, RunPod dry-run adapter and `BudgetGuard` | `ai-lab/` on `ai-lab/foundation` (not previously on `main`)                                 | REUSABLE, brought onto this branch unchanged in role                           |
| Product `ModelProvider` and UnoRouter client (`UNOROUTER_API_KEY_1/2/3`)                                                           | `src/lib/models/`                                                                           | REUSABLE for product chat. The lab fallback does **not** read those three keys |
| Settings model table                                                                                                               | `src/components/settings/model-status.tsx`                                                  | REUSABLE. A routing panel was added under it                                   |
| SCP transformer, BPE, memmap pipeline, bf16 trainer                                                                                | `swarm-compute-protocol-` `model/scp_model/` as already read for `docs/SCP_REUSE_MATRIX.md` | REQUIRES MODIFICATION before any real train. Not vendored                      |
| SCP `sandbox.py`                                                                                                                   | SCP `backend/core/sandbox.py`                                                               | UNSAFE. Not a security boundary. Not vendored                                  |
| SCP simulated swarm, commerce, OAuth, webapp                                                                                       | SCP `backend/core/protocol.py` and commerce/web stacks                                      | NOT RELEVANT / UNSAFE to present as compute. Not vendored                      |
| Rouge native training tree on `rouge/native-model-m58`                                                                             | `training/rouge/`                                                                           | DUPLICATE of the training job this milestone must not start. Not copied in     |
| DeepSeek 2T corpus claims                                                                                                          | reuse doc                                                                                   | UNSAFE to cite as provenance. Not used                                         |

SCP code was not copied. The tiny CPU fixture is a new linear map (`y = Wx + b`) so the lab can prove forward, backward, checkpoint, and restore without pretending to be the SCP stack or a trained model.

## What this milestone adds

Executable, on CPU, with no network in the default tests:

- Model, architecture, and tokenizer registries (tokenizer version pin is a sha256 of id, track, family, version, vocab size).
- Dataset train/holdout split that refuses shared ids.
- Curriculum validator.
- Tiny fixture trainer (real tensors, analytic gradients, SGD).
- JSON checkpoint manager. Pickle paths and pickle payloads are refused.
- Experiment tracker that writes a **draft** only.
- Independent MSE judge. It does not accept the training loop's own score.
- Inference providers: `NativeModelProvider`, `APIModelProvider` (UnoRouter), `FallbackModelProvider`.
- Router: native only when a validated checkpoint file exists **and** `LAB_NATIVE_RUNTIME_ONLINE=true`. Otherwise UnoRouter.
- Cost budget that stops before `fetch` when the estimate is positive and the ceiling is 0 (the default).
- RunPod path reused as config plus an unauthorized `provision` refusal. No transport.
- Artifact promotion that throws on `production_candidate` and `production`.
- Observability helper that redacts bearer tokens.
- Settings panel that polls `GET /api/lab/routing` and animates the dot only when the route is actually usable.

## Fallback behavior

Base URL default: `https://api.unorouter.com/v1`. Chat: `POST /v1/chat/completions` (joined as `{base}/chat/completions`). Auth header: `Authorization: Bearer` plus `UNOROUTER_API_KEY` from the environment only. The value is not hard-coded and is not written to logs by the lab client.

If `UNOROUTER_API_KEY` is missing, the API provider throws `UnoRouterError` and does not call the network.

Catalog check on 2026-10-02 against `https://api.unorouter.com/api/pricing/catalog` (public, no key). Defaults below are **API fallbacks**, not the native models:

| Track   | Native id (not trained) | Fallback env                 | Default catalog id       | Role           |
| ------- | ----------------------- | ---------------------------- | ------------------------ | -------------- |
| Rouge   | `osirus/rouge-1`        | `LAB_FALLBACK_MODEL_ROUGE`   | `qwen3:free`             | general        |
| Quasnir | `osirus/quasnir-1`      | `LAB_FALLBACK_MODEL_QUASNIR` | `qwen2.5-coder-32b:free` | code           |
| Darus   | `osirus/darus-1`        | `LAB_FALLBACK_MODEL_DARUS`   | `gemini-3.6-flash:free`  | broad research |

Canonical product spelling is QUASNIR (`osirus/quasnir-1`). The older scaffold spelling Quesnir is not a second model. Branch `quesnir/scaffold` is the pre-consolidation branch and is not a parallel identity.

Track JSON files are added on the three branches (`ai-lab/tracks/definitions/{rouge,quasnir,darus}.json`). They differ in architecture, tokenizer, mixture, curriculum, behavior, objectives, eval suite, training seed, inference fallback, and capability targets. Eval suites set `measured: false`.

## Status vocabulary

`infrastructure_ready`, `training_ready`, `training_running`, `checkpoint_created`, `checkpoint_validated`, `holdout_passed`, `production_candidate`, `production`.

Reachable in unit tests for the **fixture**: up to `checkpoint_validated`. `holdout_passed` is a judge result on toy rows, not a model score. `production*` is refused in code (`MILESTONE_LOCK`).

## Tested vs unverified

Tested here (see the PR test notes for commands): registries, pin mismatch, holdout isolation, finite-difference gradient, checkpoint round-trip, pickle refusal, provider switch with a mock fetch, missing key, zero-budget stop, RunPod provision without authorization, promotion lock, log redaction, routing snapshot.

Unverified: live UnoRouter completion (unit tests stay mocked), any real corpus, any GPU smoke, bit-reproducible training, human evals, and every Phase L checkbox that was already PARTIAL or NO in `docs/TRAINING_READY.md`.

## What would cost GPU money

A real RunPod or other GPU provision, an H200 smoke, or a scale training run. Those paths still require `OSIRUS_TRAINING_READY=true`, an owner key, and `dryRun=false`, and even then this scaffold throws `TransportUnavailableError` because it ships no RunPod HTTP transport. Do not flip that flag from this milestone.
