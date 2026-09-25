# M48: model-usage evolution (not fine-tuning)

M48 does not train anything and fakes no model candidates. It makes no claim
that weights changed. What evolves is **how Osirus uses the model**: the
same UnoRouter model, used differently.

## `genome.modelUse`

Every key that is absent keeps today's behavior.

| Key                | Values (default first)            | Where it acts                                                                                                                                       |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sampling`         | unset · `{temperature, topP}`     | `UnoRouterProvider` sends `temperature` / `top_p` only when set (`models/unorouter.ts`); every loop decision of the arm passes it (`arms/base.ts`). |
| `promptStyle`      | `contract_first` · `task_first`   | `task_first` leads the loop's system prompt with the task (`agent/loop.ts`).                                                                        |
| `toolDescriptions` | `summary` · `summary_with_inputs` | Each tool line also names its input fields. MCP descriptions stay quoted and untouched.                                                             |
| `handoff`          | `full` · `compact`                | How much of each earlier capability's typed handoff reaches the next one (`handoffContext`).                                                        |
| `critique`         | `none` · `self_check`             | A directive to re-derive the key result by another route before FINISH. Independent verification is unchanged.                                      |
| `roles`            | unset · `{ROLE: modelId}`         | A model per role for trials. Only IDs on the free allowlist (`models/free.ts`) are honored; everything else is dropped.                             |

## Models

- **The allowlist** holds only the free model Osirus has actually run:
  `deepseek-v4-pro-0813:free`. With one entry, per-role assignment is inert,
  and every strategy optimizes around that one model. This is stated, not
  hidden.
- **Discovering more.** The RSI live workflow lists the models the key can
  reach when run by hand. It prints IDs only, never the key. A second free
  model is added to the allowlist only once it is known to exist; model IDs
  are never invented.

## In the Foundry

- **Library.** New entries per arm:
  - self-check (verification gap);
  - tool inputs shown (tool gap);
  - task-first prompt (planning gap);
  - low temperature (knowledge gap);
  - compact handoffs for coding (context gap).
- **Meta-policy.** Sampling and roles count as the `model` mechanism; the
  others count as `prompt`.
- **Testing.** Every candidate is tested paired against the champion, on the
  same tasks with the same model, through the RIC's live orders.

## Raw model vs Osirus

The benchmark (`intelligence/benchmark/raw-vs-osirus.ts`) holds the model
fixed and varies only Osirus:

- **A:** one raw call to the free model.
- **B:** the same model inside Osirus.
- **The judge:** the same independent one for both, each task's own verify.

The live runner spends only the calls the cycle reserved. A side cut off by
the budget is excluded, not scored as a failure.
