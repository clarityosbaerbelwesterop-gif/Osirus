import type { RougeEffort, RougeMessage } from "../types";
import { agreementOf, extractFinal, answerKey } from "./answers";
import {
  approachesFor,
  briefing,
  fallbackTaskModel,
  parseTaskModel,
  TASK_MODEL_INSTRUCTION,
  type TaskModel,
} from "./task-model";

// The cognitive kernel (M57): how Rouge thinks before it answers.
//
//   1. Task model     -- what kind of problem, givens, constraints, pitfalls,
//                        difficulty, and distinct approaches (one call).
//   2. Approach search -- independent solvers, one per approach, in parallel.
//   3. Uncertainty    -- agreement between genuinely different approaches.
//   4. Metacognition  -- disagreement is adjudicated by re-deriving the
//                        answer and auditing each attempt; a unanimous answer
//                        to a hard task is verified by an independent method,
//                        and a challenged answer goes to a tie-break.
//   5. Synthesis      -- one clean answer; no attempts, no internal notes.
//
// Only reasoning tasks take the search path. Conversation, writing and open
// knowledge questions are answered directly from the task model: sampling
// three essays and voting on them buys nothing.
//
// Every step is a call to the same foundation core. What Rouge adds is the
// structure around those calls, and that is exactly what the M57 benchmark
// measures against the raw core.

export type CognitionConfig = {
  /** Independent approaches on the search path. */
  candidates: number;
  /** Re-derive and audit when approaches disagree. */
  adjudicate: boolean;
  /** Independently verify a unanimous answer to a hard task. */
  verifyHard: boolean;
  /** Difficulty from which a unanimous answer is verified. */
  verifyFrom: number;
};

export type CoreCall = (input: {
  /** Suffix for the request id, unique within one Rouge request. */
  id: string;
  system: string;
  messages: RougeMessage[];
  effort: RougeEffort;
}) => Promise<string>;

export type Thought = {
  text: string;
  finalAnswer: string;
  mode: "direct" | "search";
  taskModel: TaskModel | null;
  /** Whether the task model came from the core or the fallback. */
  modelSource: "parsed" | "fallback";
  approaches: number;
  confidence: number | null;
  adjudicated: boolean;
  verified: boolean;
  corrected: boolean;
  calls: number;
  /** The id suffix of the call whose output is the answer. */
  answeredBy: string;
};

const SEARCH_KINDS = new Set(["computation", "logic", "code"]);

const SOLVER = [
  "You are one of several independent solvers. Solve the task below with the approach you are assigned.",
  "Work concisely but show every step that matters. Before finishing, check your result against the givens, the constraints and the known pitfalls.",
  "End with exactly one line: FINAL ANSWER: <the answer alone, in the required format>",
].join("\n");

const ADJUDICATOR = [
  "You audit independent attempts at the same task. They disagree, so at least one is wrong.",
  "Do not follow the majority: majorities can be wrong. Re-derive the answer yourself, carefully, then check each attempt step by step and name the first concrete error in each wrong one.",
  "End with exactly one line: FINAL ANSWER: <the correct answer alone, in the required format>",
].join("\n");

const VERIFIER = [
  "You verify a proposed answer to a task. Several solvers agreed on it, but agreement is not proof.",
  "Check it by an independent method -- recompute differently, substitute back, or test it against every constraint -- not by re-reading their reasoning.",
  "If it holds, end with FINAL ANSWER: <the same answer>. If it does not, show the error and end with FINAL ANSWER: <the corrected answer>.",
].join("\n");

const SYNTHESIS = [
  "Write the final response to the person. The answer has been worked out and checked; it is given below.",
  "Present it clearly and concisely, with the key steps only where they help understanding.",
  "Do not mention solvers, attempts, verification or any internal process.",
].join("\n");

function lastUser(conversation: RougeMessage[]) {
  return conversation.at(-1)?.content ?? "";
}

function withFormat(system: string, contractText: string | null) {
  return contractText
    ? `${system}\nRequired answer format: ${contractText}`
    : system;
}

export async function think(input: {
  conversation: RougeMessage[];
  identity: string;
  contractText: string | null;
  /** The person fixed a short answer: the final answer is the response. */
  shortAnswer: boolean;
  /** The effort the person asked for: standard, deep or ultra. */
  effort: RougeEffort;
  config: CognitionConfig;
  call: CoreCall;
  status: (label: string) => void;
}): Promise<Thought> {
  const { conversation, identity, contractText, config, call, status } = input;
  // Solvers think at the requested effort; checking never thinks less than deep.
  const solveEffort = input.effort === "quick" ? "standard" : input.effort;
  const checkEffort: RougeEffort = input.effort === "ultra" ? "ultra" : "deep";
  let calls = 0;
  const ask = async (
    id: string,
    system: string,
    messages: RougeMessage[],
    effort: RougeEffort,
  ) => {
    calls += 1;
    return call({ id, system, messages, effort });
  };

  // 1. Task model.
  status("Understanding the task");
  const modelText = await ask(
    "model",
    `${identity}\n\n${TASK_MODEL_INSTRUCTION}`,
    conversation,
    "quick",
  ).catch(() => "");
  const parsed = parseTaskModel(modelText);
  const taskModel = parsed ?? fallbackTaskModel(lastUser(conversation));
  const modelSource = parsed ? "parsed" : "fallback";
  const brief = briefing(taskModel);

  const search =
    config.candidates >= 2 &&
    (!parsed || (taskModel.needsReasoning && SEARCH_KINDS.has(taskModel.kind)));

  if (!search) {
    status("Thinking");
    const text = await ask(
      "direct",
      withFormat(
        `${identity}\n\nWhat this task needs, as analysed before answering:\n${brief}`,
        contractText,
      ),
      conversation,
      taskModel.difficulty >= 4 ? checkEffort : solveEffort,
    );
    return {
      text,
      finalAnswer: input.shortAnswer ? extractFinal(text) : text,
      mode: "direct",
      taskModel,
      modelSource,
      approaches: 0,
      confidence: null,
      adjudicated: false,
      verified: false,
      corrected: false,
      calls,
      answeredBy: "direct",
    };
  }

  // 2. Approach search: independent solvers, one approach each.
  const approaches = approachesFor(taskModel, config.candidates);
  status(`Exploring ${approaches.length} approaches`);
  const attempts = await Promise.all(
    approaches.map((approach, index) =>
      ask(
        `solve-${index + 1}`,
        withFormat(
          `${identity}\n\n${SOLVER}\n\n${brief}\nYour approach: ${approach.name} -- ${approach.how}`,
          contractText,
        ),
        conversation,
        solveEffort,
      )
        .then((text) => ({
          approach,
          text,
          final: extractFinal(text),
          error: null as unknown,
        }))
        .catch((error: unknown) => ({ approach, text: "", final: "", error })),
    ),
  );
  const answered = attempts.filter((attempt) => attempt.final);
  // No approach produced an answer: surface why (a provider refusal keeps
  // its code, so the caller can say "no credit" rather than "failed").
  if (!answered.length)
    throw (
      attempts.find((attempt) => attempt.error)?.error ??
      new Error("no approach produced an answer")
    );

  // 3. Uncertainty: how far independent approaches agree.
  const agreement = agreementOf(attempts.map((attempt) => attempt.final));
  let final = agreement.top!.answer;
  let answeredBy = `solve-${agreement.top!.members[0]! + 1}`;
  let adjudicated = false;
  let verified = false;
  let corrected = false;

  // 4. Metacognition.
  if (!agreement.unanimous && config.adjudicate) {
    status("Cross-checking the approaches");
    const dossier = attempts
      .map(
        (attempt, index) =>
          `Attempt ${index + 1} (${attempt.approach.name}):\n${attempt.text.slice(-3000) || "(no answer)"}`,
      )
      .join("\n\n---\n\n");
    const verdict = await ask(
      "adjudicate",
      withFormat(`${identity}\n\n${ADJUDICATOR}\n\n${brief}`, contractText),
      [
        ...conversation.slice(0, -1),
        {
          role: "user",
          content: `Task:\n${lastUser(conversation)}\n\nAttempts:\n\n${dossier}`,
        },
      ],
      checkEffort,
    ).catch(() => "");
    const decided = extractFinal(verdict);
    if (decided) {
      adjudicated = true;
      corrected = answerKey(decided) !== answerKey(final);
      final = decided;
      answeredBy = "adjudicate";
    }
  } else if (
    agreement.unanimous &&
    config.verifyHard &&
    taskModel.difficulty >= config.verifyFrom
  ) {
    status("Verifying");
    const check = await ask(
      "verify",
      withFormat(`${identity}\n\n${VERIFIER}\n\n${brief}`, contractText),
      [
        ...conversation.slice(0, -1),
        {
          role: "user",
          content: `Task:\n${lastUser(conversation)}\n\nProposed answer: ${final}\n\nOne solver's working:\n${answered[0]!.text.slice(-3000)}`,
        },
      ],
      checkEffort,
    ).catch(() => "");
    const checked = extractFinal(check);
    verified = Boolean(checked);
    if (checked && answerKey(checked) !== answerKey(final)) {
      // A single dissent against a unanimous answer is not enough on its
      // own: a fresh solver breaks the tie.
      status("Resolving a disagreement");
      const fresh = approachesFor({ ...taskModel, approaches: [] }, 3).at(-1)!;
      const tiebreak = extractFinal(
        await ask(
          "tiebreak",
          withFormat(
            `${identity}\n\n${SOLVER}\n\n${brief}\nYour approach: ${fresh.name} -- ${fresh.how}`,
            contractText,
          ),
          conversation,
          checkEffort,
        ).catch(() => ""),
      );
      if (tiebreak && answerKey(tiebreak) === answerKey(checked)) {
        final = checked;
        corrected = true;
        answeredBy = "verify";
      }
    }
  }

  // 5. Synthesis.
  if (input.shortAnswer) {
    return {
      text: final,
      finalAnswer: final,
      mode: "search",
      taskModel,
      modelSource,
      approaches: approaches.length,
      confidence: agreement.confidence,
      adjudicated,
      verified,
      corrected,
      calls,
      answeredBy,
    };
  }
  status("Writing the answer");
  const text = await ask(
    "synthesis",
    withFormat(
      `${identity}\n\n${SYNTHESIS}\n\nChecked answer: ${final}\n\n${brief}`,
      contractText,
    ),
    conversation,
    "quick",
  ).catch(() => final);
  return {
    text,
    finalAnswer: final,
    mode: "search",
    taskModel,
    modelSource,
    approaches: approaches.length,
    confidence: agreement.confidence,
    adjudicated,
    verified,
    corrected,
    calls,
    answeredBy: text === final ? answeredBy : "synthesis",
  };
}
