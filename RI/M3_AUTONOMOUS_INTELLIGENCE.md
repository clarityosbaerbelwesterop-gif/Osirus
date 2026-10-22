# M3 — Autonomous Intelligence as Development of Problem-Solving Capabilities

**Status:** research proposal plus operational design; not a claim that general intelligence has been achieved.  
**Branch:** `ri/isolated-foundation`  
**Scope:** RI only.

## 1. Core reframing

RI should not be defined merely as a system that accumulates facts or learns a fixed task. The research question is whether a small system can develop a reusable organization of problem-solving capabilities from experience.

The target is **capability development**: experience changes not only what the system predicts, but also the operations it can reliably apply, combine, select, and revise in later tasks.

This is a research direction, not a claim of novelty. Related areas include meta-learning, hierarchical reinforcement learning, program induction, causal discovery, compositional generalization, developmental robotics, active learning, and continual learning. RI must identify exactly what it contributes relative to those fields.

## 2. Working model: a developmental capability cycle

1. **Encounter:** observe a task and its consequences.
2. **Compress:** identify distinctions and recurring structure that may matter.
3. **Hypothesize:** maintain multiple possible explanations or strategies.
4. **Intervene:** choose an observation or action that distinguishes alternatives.
5. **Evaluate:** compare predicted and observed outcomes.
6. **Revise:** update or discard a hypothesis or operation.
7. **Consolidate:** preserve reusable operations with evidence and known limits.
8. **Compose:** combine operations to address a task not previously solved in that form.
9. **Audit:** track confidence, failure modes, cost, and transfer evidence.

The loop should be interruptible. If evidence is insufficient, the system should request or seek information rather than fabricate certainty.

## 3. What makes this autonomous?

Autonomy here is operational, not metaphysical. A system is more autonomous to the extent that it can, within explicit boundaries:

- formulate a subgoal from a task;
- identify missing information;
- select an experiment or action for information gain;
- construct and compare candidate explanations;
- choose and execute a strategy;
- evaluate the result against external criteria;
- decide whether to retain, revise, or abandon a capability;
- select a next learning task based on a measured weakness;
- preserve a reproducible history of changes.

No single item proves general intelligence. The research target is their reliable integration and transfer.

## 4. A capability is not just a stored rule

Represent a candidate capability as a versioned object with:
- a name and operational description;
- input/output contract;
- preconditions and known limits;
- evidence and examples supporting it;
- a procedure or composition of simpler operations;
- confidence and failure statistics;
- estimated execution cost;
- tests on familiar and novel tasks;
- provenance: how it was acquired or changed.

A capability should only be promoted from a tentative hypothesis to a reusable operation after it passes independent tests. The system must not be allowed to declare its own success without external evaluation.

## 5. The crucial transition

The most important transition to test is:

**observed regularity → reusable operation → composition with another operation → transfer to a new task.**

Example: in one toy environment, a learner discovers that changing one variable while holding others fixed helps identify which factor controls an outcome. In a second environment with different surface features, it must independently select and apply the same intervention principle. The environment must not tell it to use the operation.

The claim is supported only if:
- the new task differs in surface details and is held out from development;
- simple baselines are competitive and fairly evaluated;
- the system selects or composes the operation without a task-specific hard-coded route;
- transfer persists across multiple seeds and task variants;
- ablations show whether the proposed developmental mechanism matters.

## 6. Minimal internal organization to investigate

Do not assume a neural network, LLM, symbolic engine, graph, or a particular memory design in advance. Compare the smallest plausible mechanisms:

A. fixed task-specific rules;  
B. episodic storage and retrieval;  
C. learned relation/hypothesis state;  
D. reusable operation library with explicit preconditions;  
E. capability selection and composition based on prior performance.

The implementation may use transparent symbolic structures first because they are cheap to inspect, not because symbolic systems are assumed to be the final answer. Later comparisons can challenge this choice.

## 7. Developmental stages defined by evidence

- **Stage 1 — Distinction:** distinguish entities, states, changes, and outcomes.
- **Stage 2 — Relation:** infer regularities and represent uncertainty.
- **Stage 3 — Operation:** turn a discovered regularity into a reusable procedure.
- **Stage 4 — Composition:** combine procedures and transfer them to new tasks.
- **Stage 5 — Self-directed development:** choose what to learn next, detect capability gaps, test revisions, and retain only verified improvements.

Stages are capability gates, not age analogies or fixed time periods. Progression requires passing held-out evaluations. Regression is allowed if a previous capability proves unreliable.

## 8. Autonomous learning policy

For each unresolved task, the system should compare candidate next steps by expected value:
- expected reduction in uncertainty;
- likely improvement in task success;
- relevance to multiple future tasks;
- cost in actions, time, and computation;
- risk of damaging previously verified capabilities.

This can begin as an explicit scoring rule. Do not call it human-like motivation or consciousness. Evaluate whether it actually improves learning efficiency versus random, fixed-curriculum, and uncertainty-only selection.

## 9. Memory and identity over time

Maintain distinct records for:
- raw episodes;
- inferred relations;
- tentative hypotheses;
- verified capabilities;
- task-specific plans;
- evaluation outcomes;
- change history.

Do not merge evidence and interpretation. Preserve the origin of claims. A new observation can revise an inference but should not silently rewrite the record of what was observed.

Continuity means reproducible state and a traceable history, not an unsupported claim of personal identity or consciousness.

## 10. Self-improvement boundaries

Self-improvement means proposing and testing modifications to its own strategies or capability library. It does not mean unbounded self-modification.

Every change must:
1. have a stated hypothesis;
2. be versioned;
3. run in an isolated evaluation;
4. be compared against the previous version and baselines;
5. pass regression tests on old capabilities;
6. be reversible;
7. retain raw results.

The system cannot alter its evaluator, hide failed trials, or change success thresholds after seeing outcomes.

## 11. Falsification criteria

The central M3 claim is weakened or rejected if:
- the capability library adds complexity without transfer gains;
- a simple baseline matches or beats the learner;
- performance depends on hand-coded task identities;
- claimed transfer disappears on new seeds or altered surface forms;
- improvements damage earlier skills more than they help new ones;
- the agent cannot select a useful next action better than simple baselines;
- results cannot be reproduced.

A negative result is a valid outcome and must change the roadmap.

## 12. Immediate M3 implementation target

Build a CPU-first, deterministic toy study in which an agent:
1. learns a reusable intervention/comparison operation in environment A;
2. stores it as a capability with a contract and evidence;
3. faces environment B with different names and surface layout;
4. must decide whether and how to apply the operation;
5. receives outcome feedback and can revise its capability;
6. is evaluated against fixed-rule, memorization, and random-action baselines;
7. records transfer, learning cost, uncertainty, and regression results.

Do not leak the target rule or evaluator state into the agent. Separate development tasks, validation tasks, and held-out transfer tasks. If the current toolchain cannot execute code, commit runnable source and clearly mark execution as pending rather than claiming results.

## 13. Decision rule

M3 succeeds as an engineering milestone when the experiment is reproducible, tests are valid, baselines are fair, and the report states a justified conclusion. It succeeds as evidence for the hypothesis only if predeclared results demonstrate transfer and a meaningful advantage over relevant baselines. These are separate definitions of success.
