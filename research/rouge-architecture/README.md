# Rouge architecture research

This is the Rouge Architecture Program: can a fundamentally more efficient
model architecture exist? It is kept separate from the Qwen baseline
program (`training/rouge/`) and from the Osirus runtime.

- **Plan and theory:** [`docs/rouge/research/rouge-architecture-r1.md`](../../docs/rouge/research/rouge-architecture-r1.md)
- **Milestones:** [`docs/rouge/research/milestones.md`](../../docs/rouge/research/milestones.md)

## Layout

| Path           | What                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| `benchmarks/`  | Code-generated, code-verified tasks with ID and OOD ranges                      |
| `prototypes/`  | Rouge prototypes and conventional baselines (Transformer; later LSTM, SSM, MoE) |
| `experiments/` | One pre-registration (`<id>.json`) and one runner (`<id>.py`) per milestone     |
| `results/`     | Result JSON and reports; checkpoints are CI artifacts, never committed          |
| `tests/`       | Benchmark correctness and model invariants                                      |
| `env/`         | One-command research environment for any machine                                |

Directories planned in the program are added when their first experiment
exists, not before: `theory`, `kernels`, `state`, `memory`, `routing`,
`generated-weights`, `neural-programs`, `causal`, `learning-rules`,
`sparsity`, `compression` and `papers`.

## Rules

- **Pre-register first.** The predictions and the decision rule are
  committed before the main runs.
- **Baselines at equal parameters and at equal FLOPs.**
- **Report wins and losses.** A loss is diagnosed; the mechanism is not
  scaled.
- **Lowest compute tier that answers the question.** No paid GPU without
  the owner's approval.
- **No agent code here.** No tool loops, MCP, orchestration or planners.
  That is Osirus.
- **Merging.** A milestone merges when it has a hypothesis, an experiment,
  a checkpoint, a baseline, a measurement and a written result. A negative
  result merges too if it teaches something.

## Running R1.01

```sh
env/bootstrap.sh                  # once per machine
python -m unittest discover -s tests
python experiments/r1_01.py train --model rouge --seed 1 --threads 4
python experiments/r1_01.py report
```

In CI, `.github/workflows/research-r1.yml` trains every model × seed on
its own free runner and applies the pre-registered decision.
