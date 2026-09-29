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
| `env/`         | One-command research environment (`bootstrap.sh`) and runner setup (`runner.sh`) |
| `lab/`         | Seed statistics, compute router, research controller                            |

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

## Running an experiment

```sh
env/bootstrap.sh                  # once per machine
python -m unittest discover -s tests
python experiments/r1_02.py --prereg experiments/r1_02.json train --model loop-ponder --seed 1 --threads 4
python experiments/r1_02.py --prereg experiments/r1_02.json report
```

Each pre-registration names its runner (`"runner"`); R1.01 and R1.01b use
`experiments/r1_01.py`.

## The research loop (GitHub = orchestrator, iPad = control)

`.github/workflows/research-r1.yml`, one pre-registered experiment per run:

1. **Plan.** `lab/compute.py` routes the experiment to the lowest tier that
   fits:
   - tier 0: free GitHub CPU;
   - tier 1: the owner's server (`self-hosted, rouge-research`);
   - tier 2: an owned GPU (`+ gpu`).

   Tier 3 (a rented H200) is never selected. The router refuses it, even
   when forced.
2. **Train.** A matrix of models × seeds runs, one runner each.
   - Each run writes a resume checkpoint every 500–1,000 steps (model,
     optimizer, schedule, data RNG).
   - It stops with exit 75 before the job limit.
   - "Re-run failed jobs" continues bit-exactly: the checkpoint is kept in
     the Actions cache on GitHub runners, and on disk on the owner's server.
3. **Report.** The report collects every seed and writes mean, SD and a
   95% Student-t CI. It then applies the pre-registered gate and writes the
   table to the run summary.
4. **Record.** `lab/controller.py record` appends every run to
   `experiments/registry.json` with these fields:
   - experiment, parent and hypothesis;
   - architecture, seed and dataset hash;
   - code SHA, parameters and FLOPs;
   - hardware, duration and cost;
   - metrics, result and decision.

   It commits the result to the `rouge/*` research branch. It never commits
   to main.
5. **Next.** `lab/controller.py next` dispatches the next experiment in
   `experiments/queue.json` that meets all of these:
   - it is approved;
   - it costs $0;
   - it routes to tier 0–2;
   - its predecessors are recorded.

   The controller cannot spend money, rent a GPU, change release claims or
   merge.

**From the iPad** (GitHub app or github.com → Actions → *Rouge research R1*):
- start an experiment: *Run workflow*, with the experiment id;
- stop one: *Cancel*;
- resume one: *Re-run failed jobs*;
- read results: the run summary, or `results/<id>/report.md` on the branch;
- approve the next experiments: edit `experiments/queue.json`.

**Owner's server:** `RUNNER_TOKEN=… env/runner.sh` registers it as a runner
with the labels above. Read the security note in the script first: the
repository is public.

After registering, set the repository variable `ROUGE_SELF_HOSTED=1`
(Settings → Secrets and variables → Actions → Variables). Until then, the
router keeps long runs on free GitHub runners in up to 3 resumable
attempts, each continued with *Re-run failed jobs*.
