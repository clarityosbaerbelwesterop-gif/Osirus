# M41: Collective intelligence V3

M41 makes a team a policy choice that has to earn its tokens, and settles disagreement by evidence. It extends the M26 team genome (`team.critic`), the Foundry hypothesis library, the value-of-compute estimator and the M39 mission. There is no new agent loop and no new store. Multi-agent execution is not switched on anywhere by default.

## Mechanism

| Piece                  | Where                                                                                              | What it does                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Team genome            | `strategy/runtime.ts` (`team.topology`, `team.solvers`), `agent/team.ts` `topologyOf`              | The topologies are `single`, `solver_critic`, `parallel_solvers_judge` (2–3 solvers) and `solver_adversary`. The M26 `critic: true` maps to `solver_critic`. The default is `single`: the product champion genome `{}` forms no team, and a topology reaches the product only as champion or canary.                                 |
| Dynamic team formation | `arms/team-runtime.ts` `teamStage`, `teamWorthwhile`                                               | A team is formed only for a stage whose draft is still uncertain: the check was rejected, a contradiction or open hypothesis remains, or the draft is unverified. A draft a verifier already confirmed forms no team. Cross-capability teams (researcher, builder and so on) are the M39 mission's capability switching.             |
| Shared blackboard      | `mission.blackboard` (`osirus.run_missions`)                                                       | Each entry holds a claim, its owner, a status (open, supported, disputed, refuted or confirmed), evidence refs, counter-evidence and the tests run with what they observed. Entries are structured conclusions only; no reasoning is stored.                                                                                         |
| Disagreement engine    | `settleDisagreement`                                                                               | Drafts are grouped by their load-bearing claim. The checks they offer run through the stage's own tool registry, where permissions, approvals, audit and the action ledger apply: `compute.run` for a recomputation, `sandbox.run` for a command, `research.fetch` for a source. The rules for a winner are listed below this table. |
| Adversarial worker     | `weighAttacks`, topology `solver_adversary`                                                        | The adversary attacks assumptions, coverage, sources, security, false completion and arithmetic. An attack becomes counter-evidence, and forces one synthesizer revision, only when its own check confirms it. Unchecked or unconfirmed attacks are recorded as open questions and change nothing.                                   |
| Value of delegation    | `intelligence/routing/value-of-compute.ts` `estimateTopologies`, `delegationValue`                 | Keeps a Beta posterior of the verified rate and the mean tokens per (capability × topology), from judged Foundry trials. The gain is `P_team − P_single − 0.01 × extra kTokens`. A team is recommended only when both sides have at least 3 samples and the gain is above 0.05.                                                      |
| Topology learning      | `topologyHypothesis`, `research-loop.ts` hypothesize, `genomes.ts` library and `AgentArchitecture` | The Foundry proposes a measured team win, or the next unmeasured topology that fits the arm, as a paired trial against the champion. It is promoted only through experiment, champion, canary and observation. `architectureOf` now distinguishes all four topologies.                                                               |

A claim wins only when all of these hold:

- one of the checks supports it;
- no check refutes it;
- it is the only claim that meets the first two conditions.

If no claim wins, the judge is asked once for a test that tells the claims apart. The judge does not pick a side. If that test still decides nothing, the primary draft is kept and marked `disputed`. **Votes are never counted.** The majority is recorded only for measurement.

## Evidence

### Team pulse

Source: `agent/pulse/team-suite.ts`. It is part of the unified pulse as `m41:team:*`.

The checks are real: `compute.run` goes through the production registry check runner, and candidate code runs under `node --test`. The worker drafts are fixed, so this measures the settling mechanism. It does not measure a model.

| Task            | Scenario                                                                         | Single worker    | Majority vote   | Team                                                                                                                                | Member calls | Tests run |
| --------------- | -------------------------------------------------------------------------------- | ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------- |
| MATH_SCIENCE L3 | Three solvers; two slip and agree on 45 bottles; the correct answer is 48        | wrong (45)       | **wrong (45)**  | **48**, by recomputing `4 * 12`                                                                                                     | 3            | 1         |
| CODING L4       | Two `median` implementations; one is wrong for even-length input                 | wrong            | undecided (1:1) | **correct**, by `node --test` against each                                                                                          | 2            | 2         |
| REASONING L5    | The draft says "all requirements met, 96 EUR within 100"; the items cost 102 EUR | false completion | n/a             | **revised to "102 EUR, exceeds the budget"**: the recomputation confirmed the attack, and the unchecked shipping attack stayed open | 2            | 1         |

### Production arm path

`tests/team.test.ts` runs the real general arm through the arena harness with the policy `team.topology = parallel_solvers_judge`:

1. The loop's draft says 45.
2. The restated claim and the second solver's claim are checked through `compute.run` from the arm's own toolbox.
3. The answer becomes 48.
4. `team.settled` is logged.

The same file also covers:

- a vote is never used when no test decides;
- the one escalation;
- a check offered twice runs once;
- attacks count only when confirmed;
- a check cannot reach a tool the arm is not offered;
- genome validation;
- the value-of-delegation decision, including the case where the same gain at 40k extra tokens is rejected;
- exploration as a paired trial.

## Limits

- **Live measurement is pending.** On the free model, a team costs 2–4 extra calls per stage. Whether any topology beats a single worker is for the Foundry's paired trials to measure. Nothing here claims that it does.
- **An escalation test must be a recomputation or a source.** A command offered by the judge cannot be attributed to one claim, so it is not used for escalation.
