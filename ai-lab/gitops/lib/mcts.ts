/**
 * GitOps control plane — test-time compute: PRM-guided Monte Carlo Tree Search.
 *
 * The policy model proposes `branching` next steps for a partial solution;
 * the process reward model values each new node. UCT balances exploiting
 * high-value branches against exploring rarely visited ones. With the PRM as
 * the value function there are no random rollouts: every simulation costs one
 * expansion and one scoring call, which is what the rollout budget counts.
 */

import type { TestTimeCompute } from "./schema";

export interface SearchProblem<S> {
  /** Up to `k` distinct next states (policy samples). */
  expand(state: S, k: number): Promise<readonly S[]>;
  /** Value in [0, 1] (PRM score of the partial or complete solution). */
  score(state: S): Promise<number>;
  isTerminal(state: S): boolean;
}

export interface SearchResult<S> {
  readonly best: S;
  readonly value: number;
  readonly terminal: boolean;
  readonly simulations: number;
  readonly scored: number;
}

interface Node<S> {
  readonly state: S;
  readonly depth: number;
  readonly parent: Node<S> | null;
  readonly prior: number;
  children: Node<S>[] | null;
  visits: number;
  total: number;
}

export type MctsConfig = Pick<
  TestTimeCompute,
  "maxRollouts" | "maxDepth" | "branching" | "exploration"
>;

function uct<S>(child: Node<S>, parentVisits: number, c: number): number {
  if (child.visits === 0) return Number.POSITIVE_INFINITY;
  return (
    child.total / child.visits +
    c * Math.sqrt(Math.log(parentVisits) / child.visits)
  );
}

export async function mctsSearch<S>(
  problem: SearchProblem<S>,
  root: S,
  cfg: MctsConfig,
): Promise<SearchResult<S>> {
  let scored = 1;
  const rootValue = await problem.score(root);
  const top: Node<S> = {
    state: root,
    depth: 0,
    parent: null,
    prior: rootValue,
    children: null,
    visits: 1,
    total: rootValue,
  };
  let best = {
    state: root,
    value: rootValue,
    terminal: problem.isTerminal(root),
  };
  const consider = (state: S, value: number) => {
    const terminal = problem.isTerminal(state);
    // A finished solution beats any partial one; among equals the higher value wins.
    if (
      (terminal && !best.terminal) ||
      (terminal === best.terminal && value > best.value)
    ) {
      best = { state, value, terminal };
    }
  };

  let simulations = 0;
  for (; simulations < cfg.maxRollouts; simulations++) {
    // Selection
    let node = top;
    while (node.children && node.children.length > 0) {
      const parentVisits = node.visits;
      node = node.children.reduce((a, b) =>
        uct(b, parentVisits, cfg.exploration) >
        uct(a, parentVisits, cfg.exploration)
          ? b
          : a,
      );
    }
    // Evaluation: a fresh child is valued by its PRM prior; a revisited
    // expandable leaf is expanded and valued by its best new child.
    let value: number;
    if (node.visits === 0) {
      value = node.prior;
    } else if (
      node.children === null &&
      !problem.isTerminal(node.state) &&
      node.depth < cfg.maxDepth
    ) {
      node.children = [];
      for (const state of (
        await problem.expand(node.state, cfg.branching)
      ).slice(0, cfg.branching)) {
        const v = await problem.score(state);
        scored++;
        consider(state, v);
        node.children.push({
          state,
          depth: node.depth + 1,
          parent: node,
          prior: v,
          children: null,
          visits: 0,
          total: 0,
        });
      }
      if (node.children.length > 0) {
        node = node.children.reduce((a, b) => (b.prior > a.prior ? b : a));
        value = node.prior;
      } else {
        value = node.total / node.visits;
      }
    } else {
      // Terminal, depth-limited, or dead-end leaf: reinforce its mean, no new calls.
      value = node.total / node.visits;
    }
    // Backpropagation
    for (let n: Node<S> | null = node; n; n = n.parent) {
      n.visits++;
      n.total += value;
    }
  }
  return {
    best: best.state,
    value: best.value,
    terminal: best.terminal,
    simulations,
    scored,
  };
}
