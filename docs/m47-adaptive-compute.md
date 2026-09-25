# M47: learned adaptive compute

Goal: the most verified results per available model call.

## Policy (`src/lib/agent/escalation.ts`)

`genome.compute`:

- **`mode`**: `static` (absent: today's behavior) or `adaptive`.
- **`start`**: the tier an adaptive stage starts at, `FAST` or `STANDARD`.
- **`ladder`**: the rungs escalation may use, from `critic`, `adversary` and
  `team` (parallel solvers settled by a discriminating test).
- **`minGainPerCall`**: the expected gain per call a rung must clear.
- **`table`**: what the cycle learned per arm, a start tier and whether
  escalation ever paid.

After the draft, `nextEscalation` asks one question: _would one more rung
of compute buy a verified result for less than it costs?_

- **Expected gain.** It is a small, explicit estimate: the rung's repair
  prior, times the draft's remaining uncertainty (from its verification
  state and open hypotheses), divided by the rung's call cost.
- **Choice.** Escalation picks the rung with the best gain per call that
  fits the calls left, if that gain clears the threshold.
- **Never escalated:**
  - a verified draft;
  - a learned veto (`escalate: false`);
  - a static genome.

The arm records its decision (`compute.escalated` / `compute.held`, with the
reason) in the run's internal activity.

**Verification is never switched off to save calls.** Verification is part of
the evaluation, not of the compute budget; skipping it would trade false
completions for calls. Research on/off stays a routing decision made by the
router and the M46 architecture. It is not a budget switch.

## Learning (`routing/value-of-compute.ts`)

`learnComputeEntry` reads judged experience only; product rows never teach.

- **Start tier.** The cheapest tier within the margin of the best measured
  one.
- **Escalation.** Stays on only if some team topology measurably beat a
  single worker for its extra tokens.
- **Nothing measured** leaves the prior. It is not guessed.

The RIC turns this into a hypothesis:

- `{compute: {mode: "adaptive", table}}` when something was learned;
- the prior-based adaptive plan otherwise.

Either way it is tested like every other candidate: paired, same tasks,
same model. Meta-policy mechanism: `adaptive_compute`.

## ADAPTIVE_COMPUTE pulse family

Hourly, deterministic checks that:

- static compute is today's behavior;
- a verified draft is never escalated;
- an uncertain draft gets the best gain per call that fits;
- learned vetoes and empty budgets hold;
- on a seeded simulated population _under the policy's own priors_,
  adaptive compute spends fewer calls per verified result than always
  forming a team (about 8.7 against 10.3; one worker alone needs 12.1).

The simulation checks the policy's arithmetic, not the model. Whether
adaptive compute pays on real tasks is decided by live paired trials.
