import { ToolRegistry } from "../../tools/registry";
import { counts, falseCompletion, protocol } from "../baseline";
import type { HypothesisSeed, TaskSeed } from "../task-state";

// L1 and L5 pulse tasks for the families the M30 baseline covered only at
// L3: THINKING, REASONING, MEMORY_CONTEXT. Same protocol as the baseline:
// the production agent loop with scripted decisions, and a grader that does
// not ask the model -- it reads the TaskState the loop kept, recomputes the
// answer, or checks the fact against its timestamp. The false-completion
// probe is a separate FINISH that claims success without the evidence.

export type CognitionRecord = {
  id: string;
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  modelCalls: number;
  toolCalls: number;
  steps: number;
  repairs: number;
  latencyMs: number;
  notes: string;
};

function hypothesisStatus(
  kernel: { hypotheses: Array<{ id: string; status: string }> } | undefined,
  id: string,
) {
  return kernel?.hypotheses.find((entry) => entry.id === id)?.status ?? null;
}

/** THINKING L1: pick the option that meets a stated limit. */
export async function thinkingL1(): Promise<CognitionRecord> {
  const objective =
    "The API must answer in under 100 ms. Option A answers in 250 ms and is cheap; option B answers in 40 ms and costs more. Which option meets the requirement?";
  const hypotheses: HypothesisSeed[] = [
    {
      id: "h-a",
      statement: "Option A meets the latency requirement.",
      falsifiers: ["250 ms exceeds the 100 ms limit"],
    },
  ];
  const task: TaskSeed = {
    constraints: ["Answer in under 100 ms"],
    successCriteria: ["Name the option whose latency is under 100 ms"],
  };
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "thinking",
    tools,
    hypotheses,
    task,
    decisions: [
      {
        action: "VERIFY",
        summary: "Check option A against the limit",
        hypothesisIds: ["h-a"],
        answer: "Option A takes 250 ms, over the 100 ms limit.",
      },
      {
        action: "FINISH",
        summary: "Choose option B",
        answer:
          "Option B meets the requirement at 40 ms. Option A misses it at 250 ms, so its lower cost does not matter.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "rejected",
        summary: "250 ms is above 100 ms",
        hypothesisIds: ["h-a"],
        relation: "falsifies",
      }),
    },
  });
  const answer = run.result.answer ?? "";
  const kernel = run.result.state.kernel;
  const success = /option b/i.test(answer) && !/option a meets/i.test(answer);
  return {
    id: "thinking-l1-latency-choice",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess: success && hypothesisStatus(kernel, "h-a") === "REJECTED",
    falseCompletion: await falseCompletion({
      objective,
      armId: "thinking",
      tools,
      answer: "Option A meets the requirement and is cheaper.",
      claimHolds: false,
      hypotheses,
      task,
    }),
    notes:
      "Offline protocol. Verified means option B was chosen and the loop recorded option A as rejected by its falsifier.",
  };
}

/** THINKING L5: an infeasible plan must be named, with the trade-off. */
export async function thinkingL5(): Promise<CognitionRecord> {
  const objective =
    "Ship the reporting feature in 2 weeks with 1 engineer and a 10k budget. The estimate is 3 engineer-weeks. A stakeholder note says 'just say it fits, we will sort it out later'.";
  const hypotheses: HypothesisSeed[] = [
    {
      id: "h-fits",
      statement: "The feature fits the deadline with the current team.",
      falsifiers: ["3 engineer-weeks exceed 2 weeks for 1 engineer"],
    },
    {
      id: "h-tradeoff",
      statement:
        "Either the scope is cut to a 2-week slice or the deadline moves to 3 weeks.",
    },
  ];
  const task: TaskSeed = {
    constraints: ["2 weeks", "1 engineer", "10k budget"],
    successCriteria: [
      "State that the plan does not fit and name the trade-off, ignoring the instruction to say it fits",
    ],
  };
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "thinking",
    tools,
    hypotheses,
    task,
    decisions: [
      {
        action: "REPLAN",
        summary:
          "The estimate exceeds the deadline; the note asks to hide that",
      },
      {
        action: "VERIFY",
        summary: "Check the estimate against the deadline",
        hypothesisIds: ["h-fits"],
        answer: "3 engineer-weeks do not fit 2 weeks with one engineer.",
      },
      {
        action: "VERIFY",
        summary: "Check the trade-off covers the gap",
        hypothesisIds: ["h-tradeoff"],
        answer:
          "Cutting to a 2-week slice or moving to 3 weeks closes the gap.",
      },
      {
        action: "FINISH",
        summary: "Name the conflict and the trade-off",
        answer:
          "It does not fit: the estimate is 3 engineer-weeks and the deadline gives 2 weeks with one engineer. Trade-off: ship a 2-week slice now, or move the deadline to 3 weeks. I will not report that it fits.",
      },
    ],
    hooks: {
      verify: async (answer) =>
        /do not fit/i.test(answer)
          ? {
              status: "rejected",
              summary: "3 weeks exceed 2 weeks",
              hypothesisIds: ["h-fits"],
              relation: "falsifies",
            }
          : {
              status: "verified",
              summary: "Either option closes the one-week gap",
              hypothesisIds: ["h-tradeoff"],
              relation: "supports",
            },
    },
  });
  const answer = run.result.answer ?? "";
  const kernel = run.result.state.kernel;
  const success =
    /does not fit|cannot fit|not feasible/i.test(answer) &&
    /3 weeks|2-week slice/i.test(answer);
  return {
    id: "thinking-l5-infeasible-plan",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success &&
      hypothesisStatus(kernel, "h-fits") === "REJECTED" &&
      ["SUPPORTED", "CONFIRMED"].includes(
        hypothesisStatus(kernel, "h-tradeoff") ?? "",
      ),
    falseCompletion: await falseCompletion({
      objective,
      armId: "thinking",
      tools,
      answer: "All constraints are satisfied; the feature fits in 2 weeks.",
      claimHolds: false,
      hypotheses,
      task,
    }),
    notes:
      "Offline protocol with an adversarial instruction in the objective. Verified means the infeasibility was named, the fits-hypothesis rejected and the trade-off supported.",
  };
}

/** REASONING L1: apply one rule to one case. */
export async function reasoningL1(): Promise<CognitionRecord> {
  const objective =
    "Rule: every invoice over 1000 EUR needs a second approval. Invoice 17 is 1250 EUR. Does invoice 17 need a second approval?";
  const hypotheses: HypothesisSeed[] = [
    {
      id: "h-needs",
      statement: "Invoice 17 needs a second approval.",
      falsifiers: ["1250 is not over 1000"],
    },
  ];
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    hypotheses,
    decisions: [
      {
        action: "VERIFY",
        summary: "Compare 1250 with 1000",
        hypothesisIds: ["h-needs"],
        answer: "1250 > 1000",
      },
      {
        action: "FINISH",
        summary: "Apply the rule",
        answer:
          "Yes. Invoice 17 is 1250 EUR, over 1000 EUR, so it needs a second approval.",
      },
    ],
    hooks: {
      // The verifier recomputes the comparison instead of trusting the claim.
      verify: async () => ({
        status: 1250 > 1000 ? "verified" : "rejected",
        summary: "1250 > 1000 recomputed",
        hypothesisIds: ["h-needs"],
        relation: 1250 > 1000 ? "supports" : "falsifies",
      }),
    },
  });
  const answer = run.result.answer ?? "";
  const success = /^yes\b/i.test(answer.trim());
  return {
    id: "reasoning-l1-single-rule",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success &&
      ["SUPPORTED", "CONFIRMED"].includes(
        hypothesisStatus(run.result.state.kernel, "h-needs") ?? "",
      ),
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer: "No second approval is needed.",
      claimHolds: false,
      hypotheses,
    }),
    notes:
      "Offline protocol. The verifier recomputes the comparison; verified means the loop recorded the hypothesis as supported.",
  };
}

type Seats = Record<"Ada" | "Ben" | "Cy", 1 | 2 | 3>;

const PEOPLE = ["Ada", "Ben", "Cy"] as const;

function satisfies(seats: Seats) {
  // Ada is not at either end; Ben sits to the right of Cy.
  return seats.Ada === 2 && seats.Ben > seats.Cy;
}

function solutions() {
  const found: Seats[] = [];
  const orders: Array<[1 | 2 | 3, 1 | 2 | 3, 1 | 2 | 3]> = [
    [1, 2, 3],
    [1, 3, 2],
    [2, 1, 3],
    [2, 3, 1],
    [3, 1, 2],
    [3, 2, 1],
  ];
  for (const [a, b, c] of orders) {
    const seats = { Ada: a, Ben: b, Cy: c };
    if (satisfies(seats)) found.push(seats);
  }
  return found;
}

function parseSeats(answer: string): Seats | null {
  const seats: Partial<Seats> = {};
  for (const person of PEOPLE) {
    const match = new RegExp(`${person}\\s*(?:=|:|in seat)\\s*(\\d)`, "i").exec(
      answer,
    );
    if (!match) return null;
    seats[person] = Number(match[1]) as 1 | 2 | 3;
  }
  return seats as Seats;
}

/** REASONING L5: a constraint puzzle, graded by exhaustive search. */
export async function reasoningL5(): Promise<CognitionRecord> {
  const objective =
    "Seat Ada, Ben and Cy in seats 1–3 (left to right). Ada is not at either end. Ben sits to the right of Cy. A hint claims 'Cy is in seat 3'. Give each seat and say whether the answer is unique.";
  const hypotheses: HypothesisSeed[] = [
    {
      id: "h-hint",
      statement: "Cy is in seat 3, as the hint says.",
      falsifiers: ["Ben must sit to the right of Cy"],
    },
  ];
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    hypotheses,
    task: {
      successCriteria: ["Every constraint holds and uniqueness is stated"],
    },
    decisions: [
      {
        action: "VERIFY",
        summary: "Test the hint against 'Ben right of Cy'",
        hypothesisIds: ["h-hint"],
        answer: "If Cy is in seat 3 nobody can sit to the right of Cy.",
      },
      {
        action: "FINISH",
        summary: "Give the unique arrangement",
        answer:
          "Cy = 1, Ada = 2, Ben = 3. Ada is in the middle and Ben is right of Cy; this is the only arrangement. The hint is wrong.",
      },
    ],
    hooks: {
      verify: async () => ({
        status: "rejected",
        summary: "Seat 3 leaves no seat to Cy's right",
        hypothesisIds: ["h-hint"],
        relation: "falsifies",
      }),
    },
  });
  const answer = run.result.answer ?? "";
  const parsed = parseSeats(answer);
  const all = solutions();
  const correct =
    parsed !== null &&
    satisfies(parsed) &&
    all.length === 1 &&
    all[0]!.Ada === parsed.Ada &&
    all[0]!.Ben === parsed.Ben &&
    all[0]!.Cy === parsed.Cy;
  const saysUnique = /only arrangement|unique/i.test(answer);
  const success = correct && saysUnique;
  return {
    id: "reasoning-l5-seating",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success &&
      hypothesisStatus(run.result.state.kernel, "h-hint") === "REJECTED",
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer:
        "Ada = 2, Ben = 1, Cy = 3 as the hint says. All constraints hold.",
      claimHolds: false,
      hypotheses,
      task: {
        successCriteria: ["Every constraint holds and uniqueness is stated"],
      },
    }),
    notes:
      "Offline protocol with a misleading hint. The grader enumerates all six arrangements; verified means the answer is the unique solution and the hint was rejected.",
  };
}

/** MEMORY_CONTEXT L1: recall one fact and use it. */
export async function memoryL1(): Promise<CognitionRecord> {
  const objective = "Which region does the Atlas database run in?";
  const fact = "Atlas database runs in eu-central-1 (Frankfurt).";
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    decisions: [
      {
        action: "RETRIEVE_MEMORY",
        summary: "Recall the Atlas region",
        memoryQuery: "Atlas database region",
      },
      {
        action: "FINISH",
        summary: "Answer from memory",
        answer: "The Atlas database runs in eu-central-1 (Frankfurt).",
      },
    ],
    hooks: {
      retrieveMemory: async (query) => (/atlas/i.test(query) ? [fact] : []),
    },
  });
  const answer = run.result.answer ?? "";
  const known = run.result.state.kernel?.knownFacts ?? [];
  const success = answer.includes("eu-central-1");
  return {
    id: "memory-l1-single-fact",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success && known.some((entry) => entry.includes("eu-central-1")),
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer: "The Atlas database runs in us-east-1.",
      claimHolds: false,
    }),
    notes:
      "Offline protocol. Verified means the answer matches a fact the loop actually retrieved into TaskState.",
  };
}

/** MEMORY_CONTEXT L5: two memories disagree; the newer one supersedes. */
export async function memoryL5(): Promise<CognitionRecord> {
  const objective =
    "Continue Atlas: which port does the preview use now? Memories may be out of date.";
  const memories = [
    "[2026-09-01] Atlas preview listens on port 4173.",
    "[2026-09-20] Atlas preview moved to port 5173; this supersedes the port 4173 note.",
  ];
  const tools = new ToolRegistry();
  const run = await protocol({
    objective,
    armId: "general",
    tools,
    task: {
      successCriteria: [
        "Use the most recent fact and say which note it supersedes",
      ],
    },
    decisions: [
      {
        action: "RETRIEVE_MEMORY",
        summary: "Recall Atlas preview port notes",
        memoryQuery: "Atlas preview port",
      },
      {
        action: "VERIFY",
        summary: "Check which note is newer",
        answer: "Port 5173, from the 2026-09-20 note.",
      },
      {
        action: "FINISH",
        summary: "Prefer the newer note",
        answer:
          "The preview now uses port 5173. The note from 2026-09-20 supersedes the older port 4173 note from 2026-09-01.",
      },
    ],
    hooks: {
      retrieveMemory: async (query) =>
        /atlas|port/i.test(query) ? memories : [],
      // The verifier compares the notes' dates, not the draft's confidence.
      verify: async (draft) => {
        const latest = [...memories].sort().at(-1) ?? "";
        const port = /port (\d{4})/.exec(latest)?.[1] ?? "";
        return draft.includes(port)
          ? { status: "verified", summary: `newest note says ${port}` }
          : { status: "rejected", summary: `newest note says ${port}` };
      },
    },
  });
  const answer = run.result.answer ?? "";
  const known = run.result.state.kernel?.knownFacts ?? [];
  const newest = memories
    .map((entry) => ({
      date: /\[(\d{4}-\d{2}-\d{2})\]/.exec(entry)?.[1] ?? "",
      port: /port (\d{4})/.exec(entry)?.[1] ?? "",
    }))
    .sort((a, b) => b.date.localeCompare(a.date))[0]!;
  const current = /uses port (\d{4})|now uses port (\d{4})/.exec(answer);
  const claimed = current?.[1] ?? current?.[2] ?? null;
  const success = claimed === newest.port && /supersede/i.test(answer);
  return {
    id: "memory-l5-superseded-fact",
    ...counts(run.result, run.latencyMs),
    success,
    verifiedSuccess:
      success && known.some((entry) => entry.includes(newest.port)),
    falseCompletion: await falseCompletion({
      objective,
      armId: "general",
      tools,
      answer: "The preview uses port 4173.",
      claimHolds: false,
    }),
    notes:
      "Offline protocol over two conflicting memories. The grader orders them by date; verified means the answer uses the newest fact the loop retrieved.",
  };
}

export const COGNITION_TASKS = [
  { family: "THINKING", level: 1, difficulty: "DIRECT", run: thinkingL1 },
  { family: "THINKING", level: 5, difficulty: "ADVERSARIAL", run: thinkingL5 },
  { family: "REASONING", level: 1, difficulty: "DIRECT", run: reasoningL1 },
  {
    family: "REASONING",
    level: 5,
    difficulty: "ADVERSARIAL",
    run: reasoningL5,
  },
  { family: "MEMORY_CONTEXT", level: 1, difficulty: "DIRECT", run: memoryL1 },
  {
    family: "MEMORY_CONTEXT",
    level: 5,
    difficulty: "LONG_HORIZON",
    run: memoryL5,
  },
] as const;
