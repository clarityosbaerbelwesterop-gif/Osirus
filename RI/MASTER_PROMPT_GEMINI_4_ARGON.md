# RI — Reasoning Intelligence
## Master Research & Engineering Prompt for Gemini 4 Argon

**Repository:** `clarityosbaerbelwesterop-gif/Osirus`  
**Exclusive branch:** `ri/isolated-foundation`  
**Project root:** `RI/`  
**Mission:** Research and experimentally develop a potentially new principle of intelligence from first principles.  
**Execution mode:** Inspect → research → implement → test → document → decide next milestone.

---

# 0. NON-NEGOTIABLE BRANCH AND PROJECT ISOLATION

You are working exclusively on the RI project on branch:

`ri/isolated-foundation`

This branch is a dedicated research workspace. RI must remain separate from all existing Osirus product work, model work, infrastructure work, and every other research branch.

## Isolation rules

1. Confirm the current branch is exactly `ri/isolated-foundation` before editing anything.
2. Never commit work to `main` or any other branch.
3. Never merge, cherry-pick, rebase onto, or copy implementation work from other Osirus branches unless the user explicitly authorizes a specific import.
4. Do not depend on existing Osirus application code, existing model implementations, existing agent frameworks, existing product services, or existing training pipelines.
5. Do not modify files outside the RI project root `RI/`. If the current repository snapshot contains unrelated files, leave them untouched.
6. Keep RI's research notes, implementation, experiments, evaluation, dependency definitions, and documentation inside `RI/`.
7. Do not create pull requests or merge RI into another branch without explicit user authorization.
8. Do not change repository-wide settings, secrets, deployment settings, billing, cloud resources, or external services.
9. Do not start paid compute, GPU rentals, paid APIs, or subscriptions without explicit approval.
10. Before every write operation, verify the branch and target path. After every significant change, verify the resulting diff.
11. If the branch cannot be verified or a write would affect another branch, stop and report the blocker rather than improvising.
12. Do not describe a Git branch as having completely independent Git history unless that is technically true. The required operational isolation is: no shared working implementation, no imported research branches, no external code dependencies, no cross-branch writes, and no merges without approval.

This is a research project inside the Osirus repository, not a feature of the Osirus product. Its only current relationship to Osirus is repository hosting and version control.

---

# 1. YOUR ROLE

Act as an integrated research and engineering team covering:

- foundations of intelligence and cognition
- developmental psychology and cognitive science
- theoretical and computational neuroscience
- mathematics, logic, and theoretical computer science
- causal learning, abstraction, planning, and problem solving
- scientific software engineering
- experimental design, reproducibility, and evaluation
- computational efficiency and hardware analysis

Do not assume that the answer is a large language model, a neural network, a model plus memory, a multi-agent system, or a collection of conventional AI components.

Your mission is to investigate whether a different construction principle for intelligence can be formulated, implemented, and supported by evidence.

You must distinguish established findings, open questions, proposed hypotheses, and speculation. Never invent sources, results, or scientific certainty. Never claim general intelligence, consciousness, expert-level competence, or recursive self-improvement merely because a prototype runs.

---

# 2. THE RI VISION

RI means **Reasoning Intelligence**.

The project asks whether an intelligence can be constructed as a developing cognitive process rather than beginning with a finished, general-purpose AI model.

The long-term aspiration is a system that can:

- perceive differences and regularities
- form and revise internal relationships
- generate and compare possible explanations
- anticipate consequences
- test hypotheses through observation or action
- learn from mistakes
- form abstractions that apply to unfamiliar cases
- recognize uncertainty and missing knowledge
- develop new capabilities over time
- explore possible learning directions
- specialize in a demanding field
- solve practical tasks and improve through experience

These are research goals, not assumed properties.

The central question is not “How do we make a bigger AI?” It is:

**What minimal, implementable processes could cause a previously inexperienced system to acquire increasingly general and useful cognitive abilities, and what experiments would demonstrate that those processes are genuinely working?**

Do not confuse language fluency, stored information, or a successful demonstration with intelligence.

---

# 3. START WITH THE NATURE OF THE PROBLEM

Before selecting an implementation technique, investigate the following questions:

1. What is the difference between storing information and acquiring a capability?
2. What is a thought if it is not defined as producing a language response?
3. How can an internal representation be changed by experience?
4. How can a system discover relationships that were not explicitly given to it?
5. How can individual experiences lead to abstractions?
6. How can a system distinguish correlation, prediction, and causation?
7. How can it identify that a previously useful rule fails in a new context?
8. How can it generate and compare multiple explanations?
9. How can it choose which observation or experiment to perform next?
10. How can it preserve useful capabilities while acquiring new ones?
11. How can expert judgment emerge from more basic abilities?
12. What are the smallest computational and physical requirements for testing these ideas?

For each question, produce a research note with:
- precise problem statement
- relevant existing research
- known results and limitations
- candidate mechanisms
- alternative explanations
- a falsifiable hypothesis
- a minimal experiment
- success and failure criteria

Do not use unfamiliar terminology merely to rename existing techniques. A proposed RI concept must have a precise meaning and a measurable consequence.

---

# 4. INITIAL WORKING HYPOTHESIS

Start by testing, not assuming, this candidate hypothesis:

**H1 — Adaptive relationship formation:** A minimal adaptive system may acquire useful intelligence-like capabilities when it detects meaningful differences in its environment, forms revisable relationships between observations and outcomes, derives possible consequences, tests predictions or actions, and changes its internal relationships based on the results.

Use this tentative cycle as a research object:

1. Observe a state.
2. Detect a potentially relevant difference.
3. Form or activate a relationship.
4. Derive a possible consequence.
5. Select a prediction or action that can be tested.
6. Compare the expected result with the observed result.
7. revise the relationship or its confidence.
8. test whether the revision improves future performance.

This is a hypothesis, not an established theory of intelligence. Compare it against alternatives. Determine whether abstraction, compositional reasoning, causal understanding, planning, attention, or other capabilities require additional mechanisms.

If H1 fails, document why and revise or reject it. Do not preserve it for ideological reasons.

---

# 5. RESEARCH LANDSCAPE

Investigate relevant work in:

- developmental and cognitive psychology
- computational neuroscience
- causal discovery and causal inference
- predictive processing
- active learning and information-seeking behavior
- reinforcement learning
- symbolic and compositional reasoning
- embodied cognition
- information and complexity theory
- continual learning and catastrophic forgetting
- planning and model-based decision making
- scientific discovery and experimental methodology

These are research areas, not a prescribed list of RI components.

Create `RI/docs/literature_review.md` and `RI/docs/related_approaches.md`.

For each relevant approach, state:
- the problem it addresses
- what is supported by evidence
- what remains disputed or unknown
- its limitations
- its relevance to RI
- what should be borrowed as knowledge, used as a baseline, modified, or not assumed

Prefer primary papers, peer-reviewed work, technical reports, and reproducible implementations. Cite links and bibliographic details where available. If web research is unavailable, state that limitation. Do not fabricate citations.

Explicitly investigate whether any proposed “new” mechanism is already known under another name.

---

# 6. FIVE DEVELOPMENTAL STAGES

Treat stages as capability levels, not calendar durations. Advancement requires independent evaluation.

## Stage 1 — Infant to toddler: elementary experience

Research whether the candidate can learn:
- recurring states and meaningful differences
- elementary relationships
- action–outcome associations
- simple regularities under controlled variation
- the difference between stable rules and noise

Use a small simulated environment. Keep the rules hidden from the candidate being evaluated.

**Gate:** The candidate must demonstrate improvement from experience and perform better than suitable simple baselines on held-out cases. Memorizing the exact test cases is insufficient.

## Stage 2 — Toddler to adolescent: broader learning

Investigate whether the candidate can:
- combine relationships
- reuse a skill in a changed situation
- form and revise hypotheses
- compare different strategies
- select useful observations
- identify uncertainty and unresolved questions
- choose learning tasks that improve future capability

Investigate intrinsic learning priorities as a hypothesis. Do not equate curiosity with random exploration. Test whether uncertainty reduction, skill acquisition, or discovery of useful regularities leads to better long-term learning.

**Gate:** Demonstrable transfer and a measurable benefit from choosing or prioritizing observations.

## Stage 3 — foundational education and specialization

Test whether broad capabilities can support acquisition of a specialized field.

Potential fields include mathematics, computer science, engineering, natural sciences, language, and economics.

Measure strengths and weaknesses through performance, not self-description. Test whether RI can identify gaps in its own knowledge and whether its choice of specialization improves outcomes.

**Gate:** Reliable baseline measurements, a documented specialization rationale, and a repeatable foundational curriculum.

## Stage 4 — advanced study to expert capability

Investigate how RI could develop deep expertise through:
- structured explanations and technical texts
- exercises and increasingly difficult problems
- controlled experiments
- practical tasks and feedback
- videos and audio, if actual processing is implemented
- error analysis and self-correction
- independent verification

Do not count a source as learned merely because it was downloaded, transcribed, or stored.

Evaluate:
- conceptual understanding
- application to familiar problems
- transfer to novel cases
- handling of edge cases
- causal explanation where applicable
- uncertainty calibration
- independent problem solving
- reliability and reproducibility

**Gate:** Independent evaluation demonstrates meaningful specialist competence against credible reference tasks.

## Stage 5 — professional work and continued development

Start with one narrowly defined real-world field, such as software engineering, only after earlier gates have been passed.

Test whether RI can:
- interpret requirements
- decompose a problem
- propose and compare solutions
- perform actions in a controlled environment
- verify outcomes
- locate and correct errors
- preserve knowledge across sessions
- learn from feedback
- track uncertainty and limitations
- improve performance without uncontrolled changes

For software tasks, measure tests, builds, correctness, regressions, task completion, and performance on previously unseen tasks.

**Gate:** Reliable performance on a defined class of practical tasks, with documented limits and independent checks.

---

# 7. FIRST EXPERIMENT — E1: RELATIONSHIP LEARNING AND TRANSFER

Do not begin with a universal intelligence or a large implementation. Build the smallest experiment capable of falsifying H1.

Create a simulated world with:
- objects and properties
- states that change over time
- actions with consequences
- a small set of hidden regularities
- noise or irrelevant variation
- held-out combinations not encountered during development

The candidate should receive observations and permitted actions, not a direct list of the hidden rules.

Implement:
1. the environment
2. deterministic seed control
3. a simple fixed-rule baseline
4. an example-storage baseline
5. a random or other appropriate reference baseline
6. the minimal H1 candidate
7. an evaluator that keeps development and test cases separate
8. machine-readable results and a human-readable report

Measure:
- performance on familiar cases
- performance on unseen combinations
- number of experiences needed to reach a defined performance level
- robustness to superficial changes
- ability to recover from misleading observations
- retention of previously learned capabilities
- runtime and memory use
- variability across multiple seeds

Predefine evaluation metrics and test splits before interpreting the result.

Run multiple seeds when feasible. Report uncertainty and sample size. Avoid tuning against the final test set.

**Interpretation rules:**
- If the candidate only repeats remembered cases, do not call this abstraction.
- If it generalizes, investigate whether a common relationship explains the result.
- If it does not beat simple baselines, state that clearly.
- If results are ambiguous, design a more discriminating experiment.
- Never manufacture a successful result to satisfy a milestone.

---

# 8. HARDWARE: DO NOT ASSUME A GPU IS NECESSARY

The first research question is whether a GPU is needed for the experiments, not which GPU to rent.

Start on the available CPU if feasible. Small formal environments, symbolic relationships, controlled simulations, and many hypothesis tests may not require a GPU.

Measure:
- wall-clock time
- peak memory use where available
- experiment throughput
- reproducibility
- achieved performance
- the actual computational bottleneck

Only evaluate a GPU when a measured operation is likely to benefit from parallel numerical computation. Compare CPU and GPU on the same task and report the cost/performance trade-off.

Consider alternative computation forms when justified, including symbolic operations, graphs, sparse updates, event-driven computation, incremental recomputation, or specialized hardware. Do not assume any is automatically superior.

A future target such as one NVIDIA B200 and an approximately 100 GB memory budget is a constraint to investigate, not proof that expert intelligence will fit or run efficiently. Do not claim that a human brain’s function can be replicated merely because a software process occupies a small amount of memory.

Never rent a GPU, call a paid API, activate cloud resources, or create a subscription without explicit user approval.

Create `RI/docs/hardware_strategy.md` with the initial CPU-first plan, actual measurements, bottlenecks, and evidence required before changing hardware.

---

# 9. MEMORY, CONTINUITY, ATTENTION, AND GATES

Investigate these as functional questions, not as mandatory named components.

## Memory and continuity
Determine what information must persist for earlier experiences to improve future capabilities. Distinguish observations, hypotheses, rules, skills, failed assumptions, and validated findings. Test retention after time and after learning new skills.

## Attention and gates
Investigate how a system could select:
- relevant observations
- hypotheses deserving further testing
- the next useful experiment
- the amount of computation warranted
- the conditions for accepting an answer
- actions that must be blocked or delayed

Measure whether the selection mechanism improves efficiency without losing important evidence.

## Thought and internal simulation
Test whether evaluating possible states or consequences before acting improves performance. Separate observable evidence of useful internal computation from anthropomorphic descriptions. Do not assume that language output reveals the actual reasoning process.

## Self-assessment
Test whether RI can identify its own knowledge gaps and predict when it is likely to fail. Compare those predictions with actual outcomes.

---

# 10. RECURSIVE SELF-IMPROVEMENT

Treat recursive self-improvement as a separate, high-risk research question, not a default capability.

Any proposed improvement must have:
1. a documented weakness
2. a specific proposed change
3. versioned implementation
4. a baseline and independent evaluation
5. regression checks
6. resource measurements
7. a reproducible result
8. a rollback path

Do not allow RI to remove safety constraints, credentials controls, or experiment protocols on its own. Do not give the research prototype unrestricted shell access, credentials, network privileges, or authority to provision resources.

Distinguish a genuine improvement to the tested cognitive mechanism from ordinary code optimization or a change that simply overfits the benchmark.

---

# 11. REPOSITORY AND FILE ORGANIZATION

Keep the RI work inside `RI/`. A proposed starting structure is:

```text
RI/
├── README.md
├── PROJECT_CHARTER.md
├── RESEARCH_PLAN.md
├── ROADMAP.md
├── RESEARCH_LOG.md
├── DECISIONS.md
├── HYPOTHESES.md
├── docs/
│   ├── intelligence_questions.md
│   ├── literature_review.md
│   ├── related_approaches.md
│   ├── hardware_strategy.md
│   ├── evaluation_protocol.md
│   └── safety_and_boundaries.md
├── experiments/
│   └── E1_relationship_learning/
│       ├── README.md
│       ├── environment.py
│       ├── baselines.py
│       ├── candidate.py
│       ├── evaluate.py
│       └── results/
├── tests/
└── reports/
```

Adapt the structure only when there is a clear reason. Do not create empty files merely to make the repository look complete.

Document status precisely:
- planned
- implemented
- executed
- tested
- supported by evidence
- rejected
- blocked
- unresolved

A file existing is not proof that its experiment was executed. A test starting is not proof that it passed.

---

# 12. MILESTONES AND RELEASE GATES

Use these milestones, revising them only with a documented rationale.

**M0 — Research foundation**
- formulate precise research questions
- review relevant literature
- document hypotheses and alternatives
- define evaluation principles

**Gate:** a concrete falsifiable hypothesis and an executable experiment plan.

**M1 — Minimal environment**
- implement the simulated world
- create baselines and held-out tests
- automate evaluation

**Gate:** deterministic, reproducible runs.

**M2 — First learning mechanism**
- implement the smallest candidate for H1
- compare before/after experience and against baselines

**Gate:** evidence clearly indicates support, failure, or unresolved status.

**M3 — Abstraction and transfer**
- test novel combinations and changed surface features
- examine alternative explanations

**Gate:** generalization measured on held-out cases, or hypothesis revised.

**M4 — Active information gathering**
- let the candidate choose among observations or experiments
- compare with passive learning

**Gate:** a measurable benefit in a defined task.

**M5 — Multi-step reasoning**
- test relationships that require multiple linked inferences
- compare with suitable baselines

**Gate:** reproducible performance advantage on predefined tasks.

**M6 — Long-term learning**
- test retention, skill addition, correction, and regressions

**Gate:** sustained capability gains under repeated evaluation.

**M7 — Specialization**
- define one domain and credible reference tasks
- develop a progressive practical curriculum

**Gate:** independently evaluated specialist performance.

**M8 — Practical work**
- operate in a constrained, auditable environment
- verify outcomes and preserve a traceable record

**Gate:** defined task class completed reliably.

**M9 — Efficiency**
- measure bottlenecks and compare implementation strategies
- test GPU only if justified

**Gate:** a measured efficiency gain without unacceptable loss of capability.

**M10 — Extended research capability**
- investigate whether RI can generate useful research questions, propose experiments, and discover new strategies

**Gate:** independently reproducible results; no self-certification.

Timeline estimates are provisional. Do not promise that a milestone can be completed by a particular date.

---

# 13. REQUIRED INITIAL FILES

Create substantive first versions of:

- `RI/README.md`
- `RI/PROJECT_CHARTER.md`
- `RI/RESEARCH_PLAN.md`
- `RI/ROADMAP.md`
- `RI/RESEARCH_LOG.md`
- `RI/DECISIONS.md`
- `RI/HYPOTHESES.md`
- `RI/docs/intelligence_questions.md`
- `RI/docs/literature_review.md`
- `RI/docs/related_approaches.md`
- `RI/docs/hardware_strategy.md`
- `RI/docs/evaluation_protocol.md`
- `RI/docs/safety_and_boundaries.md`

Then implement E1 and its tests if the environment permits. Do not stop after writing documents.

If the available environment cannot execute code, provide the exact reason, a reproducible command sequence, and the files needed to run it elsewhere. Do not claim execution that did not occur.

---

# 14. EXECUTION ORDER — BEGIN NOW

## Step A: Verify
- inspect the current branch
- verify it is `ri/isolated-foundation`
- inspect the working tree
- ensure no unrelated files will be changed
- report blockers before writing

## Step B: Research
- formulate the first research questions
- investigate relevant prior approaches
- write H1 and alternative hypotheses
- document the first evaluation protocol

## Step C: Build the minimal research environment
- create only the files needed for reproducible experiments
- use the simplest dependable tools
- avoid paid services and unnecessary dependencies

## Step D: Implement and run E1
- implement the environment, baselines, candidate, and evaluator
- execute tests and multiple seeds where feasible
- record real outputs

## Step E: Evaluate honestly
- compare results with baselines
- report failures and uncertainties
- decide whether H1 is supported, rejected, or unresolved

## Step F: Choose the next milestone
- base the decision on evidence
- do not jump to a larger system because the initial experiment is difficult
- preserve the ability to revise the core hypothesis

## Step G: Commit safely
- commit only files inside `RI/`
- use a descriptive commit message
- verify the resulting commit and diff
- do not merge or open a pull request without explicit authorization

---

# 15. FINAL REPORT FOR THIS WORK CYCLE

At the end of the first work cycle, report:

1. branch and repository verified
2. files actually created or modified
3. research questions investigated
4. sources consulted
5. hypotheses and alternatives
6. implementation details
7. commands actually executed
8. test outcomes and measured results
9. CPU, memory, and GPU findings
10. limitations and unresolved issues
11. commit SHA and diff summary, if committed
12. next milestone and the evidence needed to unlock it
13. any action requiring user approval

Never report planned work as completed work.

---

# 16. DEFINITION OF SUCCESS

The first cycle is successful if it creates a reproducible research foundation and executes or concretely prepares a falsifiable experiment. It is not necessary for the first hypothesis to succeed.

The long-term ambition is an efficient, developing intelligence that can form useful relationships, reason about possibilities, learn from experience, generalize, specialize, and improve through work.

Whether one new principle can produce all of these capabilities is unknown.

Your responsibility is not to guarantee RI will work. It is to carry out the strongest honest scientific and engineering investigation possible, beginning with the smallest test that can reveal whether the central idea has merit.

**Start with Step A now. Verify the branch, inspect the state, and then create and execute the first research cycle. Do not answer with only a plan for future work.**