import type { ExperimentDecision, Partition, Trial } from "../types";
import {
  differenceInterval,
  discordance,
  MIN_PAIRED,
  probabilityBetter,
  signTestP,
  type PairedOutcome,
} from "./stats";

// Champion/challenger analysis over trials on identical tasks.
//
// Only completed trials count, and only ones the provider did not abort: a
// rate limit is not evidence about a strategy. For each challenger the
// comparison is paired task by task. The decision rule is written down in
// the experiment's design and applied here without exceptions.

export const DECISION_RULE =
  "Improved when, over dev and holdout together, the challenger has P(better) >= 0.85 on at least " +
  `${MIN_PAIRED} paired tasks, more challenger-only than champion-only successes, holdout not worse, ` +
  "adversarial not worse by more than one task, and no more false completions. Regressed when P(better) <= 0.15. " +
  "Anything else is inconclusive.";

export const SCREEN_THRESHOLD = 0.6;

const valid = (trial: Trial) =>
  trial.status === "completed" &&
  trial.result !== null &&
  !trial.result.failureClass?.startsWith("provider:");

function pairs(
  trials: Trial[],
  championId: string,
  challengerId: string,
  partitions: Partition[],
) {
  const byTask = new Map<
    string,
    { champion?: boolean; challenger?: boolean }
  >();
  for (const trial of trials) {
    if (!valid(trial) || !partitions.includes(trial.partition)) continue;
    if (
      trial.strategyVersionId !== championId &&
      trial.strategyVersionId !== challengerId
    )
      continue;
    const key = `${trial.evalTaskId}:${trial.replicate}`;
    const entry = byTask.get(key) ?? {};
    if (trial.strategyVersionId === championId)
      entry.champion = trial.result!.verified;
    else entry.challenger = trial.result!.verified;
    byTask.set(key, entry);
  }
  const out: PairedOutcome[] = [];
  for (const [taskId, entry] of byTask)
    if (entry.champion !== undefined && entry.challenger !== undefined)
      out.push({
        taskId,
        champion: entry.champion,
        challenger: entry.challenger,
      });
  return out;
}

function sideStats(
  trials: Trial[],
  versionId: string,
  partitions: Partition[],
) {
  const rows = trials.filter(
    (trial) =>
      valid(trial) &&
      trial.strategyVersionId === versionId &&
      partitions.includes(trial.partition),
  );
  return {
    n: rows.length,
    verified: rows.filter((trial) => trial.result!.verified).length,
    falseCompletions: rows.filter((trial) => trial.result!.falseCompletion)
      .length,
    modelCalls: rows.reduce((sum, trial) => sum + trial.result!.modelCalls, 0),
    costUsd: rows.reduce((sum, trial) => sum + trial.result!.costUsd, 0),
  };
}

export function compare(
  trials: Trial[],
  championId: string,
  challengerId: string,
  partitions: Partition[],
) {
  const paired = pairs(trials, championId, challengerId, partitions);
  const champion = {
    successes: paired.filter((pair) => pair.champion).length,
    trials: paired.length,
  };
  const challenger = {
    successes: paired.filter((pair) => pair.challenger).length,
    trials: paired.length,
  };
  const disc = discordance(paired);
  const championSide = sideStats(trials, championId, partitions);
  const challengerSide = sideStats(trials, challengerId, partitions);
  const perCall = (side: typeof championSide) =>
    side.n ? side.modelCalls / side.n : null;
  const championCalls = perCall(championSide);
  const challengerCalls = perCall(challengerSide);
  return {
    paired: paired.length,
    champion: { verified: champion.successes, n: champion.trials },
    challenger: { verified: challenger.successes, n: challenger.trials },
    probabilityBetter: paired.length
      ? probabilityBetter(challenger, champion)
      : 0.5,
    interval: differenceInterval(challenger, champion),
    discordant: disc,
    signTestP: signTestP(disc.challengerOnly, disc.championOnly),
    falseCompletionDelta:
      (challengerSide.n
        ? challengerSide.falseCompletions / challengerSide.n
        : 0) -
      (championSide.n ? championSide.falseCompletions / championSide.n : 0),
    // Cost is compared in model calls: on a free model every call costs $0,
    // but calls are the scarce resource.
    costRatio:
      championCalls && challengerCalls ? challengerCalls / championCalls : null,
  };
}

/** Which challengers deserve adversarial and holdout trials. */
export function screen(
  trials: Trial[],
  championId: string,
  challengerIds: string[],
) {
  return challengerIds
    .map((id) => ({ id, ...compare(trials, championId, id, ["dev"]) }))
    .filter(
      (entry) =>
        entry.paired >= 1 &&
        entry.probabilityBetter >= SCREEN_THRESHOLD &&
        entry.discordant.challengerOnly >= entry.discordant.championOnly,
    )
    .sort((a, b) => b.probabilityBetter - a.probabilityBetter);
}

export function decide(
  trials: Trial[],
  championId: string,
  challengerIds: string[],
  finalistId: string | null,
): ExperimentDecision {
  const comparisons: ExperimentDecision["comparisons"] = [];
  for (const id of challengerIds)
    for (const partition of ["dev", "adversarial", "holdout"] as Partition[]) {
      const result = compare(trials, championId, id, [partition]);
      if (!result.paired) continue;
      comparisons.push({
        versionId: id,
        partition,
        tasks: result.paired,
        champion: result.champion,
        challenger: result.challenger,
        probabilityBetter: Number(result.probabilityBetter.toFixed(4)),
        discordant: result.discordant,
        signTestP: Number(result.signTestP.toFixed(4)),
        costRatio:
          result.costRatio === null
            ? null
            : Number(result.costRatio.toFixed(3)),
        falseCompletionDelta: Number(result.falseCompletionDelta.toFixed(4)),
      });
    }

  if (!finalistId)
    return {
      outcome: "no_improvement",
      winnerVersionId: null,
      summary:
        "No challenger passed the dev screen (P(better) >= 0.6 with at least as many challenger-only successes).",
      comparisons,
    };

  const core = compare(trials, championId, finalistId, ["dev", "holdout"]);
  const holdout = compare(trials, championId, finalistId, ["holdout"]);
  const adversarial = compare(trials, championId, finalistId, ["adversarial"]);
  const holdoutOk = holdout.challenger.verified >= holdout.champion.verified;
  const adversarialOk =
    adversarial.challenger.verified >= adversarial.champion.verified - 1;
  const falseCompletionOk = core.falseCompletionDelta <= 0;

  if (core.paired >= MIN_PAIRED && core.probabilityBetter <= 0.15)
    return {
      outcome: "regressed",
      winnerVersionId: null,
      summary: `The finalist is worse than the champion (P(better) ${core.probabilityBetter.toFixed(2)} on ${core.paired} paired tasks).`,
      comparisons,
    };

  if (
    core.paired >= MIN_PAIRED &&
    core.probabilityBetter >= 0.85 &&
    core.discordant.challengerOnly > core.discordant.championOnly &&
    holdoutOk &&
    adversarialOk &&
    falseCompletionOk
  )
    return {
      outcome: "improved",
      winnerVersionId: finalistId,
      summary: `Verified improvement: ${core.challenger.verified}/${core.paired} vs ${core.champion.verified}/${core.paired} on dev+holdout (P(better) ${core.probabilityBetter.toFixed(2)}, sign test p=${core.signTestP.toFixed(3)}); holdout ${holdout.challenger.verified}/${holdout.paired} vs ${holdout.champion.verified}/${holdout.paired}; adversarial ${adversarial.challenger.verified}/${adversarial.paired} vs ${adversarial.champion.verified}/${adversarial.paired}.`,
      comparisons,
    };

  const reasons = [
    core.paired < MIN_PAIRED ? `only ${core.paired} valid paired tasks` : null,
    core.probabilityBetter < 0.85
      ? `P(better) ${core.probabilityBetter.toFixed(2)} < 0.85`
      : null,
    core.discordant.challengerOnly <= core.discordant.championOnly
      ? "no net challenger-only successes"
      : null,
    holdoutOk ? null : "worse on holdout",
    adversarialOk ? null : "worse on adversarial",
    falseCompletionOk ? null : "more false completions",
  ].filter(Boolean);
  return {
    outcome: "inconclusive",
    winnerVersionId: null,
    summary: `Not accepted: ${reasons.join("; ")}.`,
    comparisons,
  };
}
