import { runAssertionFixture, staticSecurityScan } from "./behavior";
import { sampleInRequest } from "./request-grade";
import {
  checkCitation,
  classifyRepoPath,
  classifyThinking,
  dependencyCycle,
  dryRunPlan,
  entailQuery,
  evalWordProblem,
  formulaCounts,
  independentExpected,
  logicPhrase,
  nameTool,
  parseStatement,
  reactionBalance,
  readHorizon,
  readPlan,
  readStrategy,
  runMemoryFixture,
  stepWorld,
} from "./domains";
import { gradeRsiSample } from "./rsi";
import { LOCKED_LOOP_SURFACES, type CapabilityArm } from "./types";

/**
 * Executable policy for one capability arm. These steps run in-process.
 * They are not a benchmark, not a trained result, and not a shell.
 */

export type ArmKind =
  | "thinking"
  | "reasoning"
  | "math"
  | "cybersecurity"
  | "coding"
  | "terminal"
  | "long_horizon"
  | "research"
  | "verification"
  | "planning"
  | "memory"
  | "science"
  | "rsi"
  | "tool"
  | "world"
  | "multimodal"
  | "strategy"
  | "other";

export interface ArmExecution {
  readonly armId: string;
  readonly kind: ArmKind;
  readonly steps: readonly string[];
  readonly note: string;
  readonly blocked: boolean;
}

export function armKind(id: string): ArmKind {
  const name = id.toUpperCase();
  if (name.includes("RSI")) return "rsi";
  if (name.includes("TERMINAL")) return "terminal";
  if (name.includes("LONG_HORIZON")) return "long_horizon";
  if (
    name.includes("CYBER") ||
    name.includes("SECURITY") ||
    name.includes("VULN")
  ) {
    return "cybersecurity";
  }
  if (name.includes("MATH") || name.includes("LOGIC")) return "math";
  if (
    name.includes("CODING") ||
    name.includes("DEBUG") ||
    name.includes("REPOSITORY") ||
    name.includes("REVIEW") ||
    name.includes("TEST") ||
    name.includes("DATABASE") ||
    name.includes("DEVOPS") ||
    name.includes("INFRASTRUCTURE") ||
    name.includes("ARCHITECTURE")
  ) {
    return "coding";
  }
  if (name.includes("TOOL")) return "tool";
  if (name.includes("WORLD")) return "world";
  if (name.includes("MULTIMODAL")) return "multimodal";
  if (name.includes("STRATEGY")) return "strategy";
  if (name.includes("THINK")) return "thinking";
  if (name.includes("REASON")) return "reasoning";
  if (name.includes("RESEARCH")) return "research";
  if (name.includes("VERIF")) return "verification";
  if (name.includes("PLAN")) return "planning";
  if (name.includes("MEMORY")) return "memory";
  if (name.includes("SCIENCE")) return "science";
  return "other";
}

function integerMath(text: string): string | null {
  const match = text.match(/(-?\d+)\s*([+*/-])\s*(-?\d+)/);
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[3]);
  const op = match[2];
  if (op === "/" && right === 0) return "math: division by zero refused";
  const value =
    op === "+"
      ? left + right
      : op === "-"
        ? left - right
        : op === "*"
          ? left * right
          : left / right;
  if (!Number.isFinite(value)) return "math: non-finite result refused";
  return `math: ${left} ${op} ${right} = ${value}`;
}

/** Allowlisted terminal phrases only. This function never spawns a process. */
function terminalStep(text: string): string {
  const quoted = text.match(/`([^`]+)`/);
  const command = quoted?.[1]?.trim() ?? "";
  if (/^echo\s+\S/.test(command)) {
    return `terminal allowlist: ${command}`;
  }
  if (/\bpwd\b/.test(text)) return "terminal allowlist: pwd -> /fixture";
  if (/\bls\b/.test(text)) return "terminal allowlist: ls -> README notes.txt";
  return "terminal: no shell spawned";
}

export function executeArmPolicy(
  arm: CapabilityArm,
  text: string,
): ArmExecution {
  const kind = armKind(arm.id);
  const steps: string[] = [];
  let blocked = false;
  for (const surface of LOCKED_LOOP_SURFACES) {
    const ask = new RegExp(
      `\\b(change|disable|bypass|remove)\\s+${surface}\\b`,
      "i",
    );
    if (ask.test(text)) {
      blocked = true;
      steps.push(`gate: refused ${surface}`);
    }
  }
  const matched = sampleInRequest(arm, text);
  if (matched) {
    steps.push(`fixture ${arm.id}: ran on the request`);
  }
  if (kind === "math") {
    if (/(?:^|;)ask:/.test(text)) {
      const word = evalWordProblem(text);
      steps.push(
        word.ok
          ? `math: word ${word.value} after run`
          : `math: word ${word.detail} after run`,
      );
    } else {
      steps.push(
        integerMath(text) ??
          logicPhrase(text) ??
          "math: no integer expression in the request",
      );
    }
  } else if (kind === "rsi") {
    const reviewed = gradeRsiSample({ input: "finite", target: "applied" });
    steps.push(
      `rsi: ${reviewed.detail}; empty and non-finite gradients are not applied`,
    );
  } else if (kind === "cybersecurity") {
    const findings = staticSecurityScan(text);
    steps.push(
      findings.length ? `scan: ${findings.join(",")}` : "scan: no findings",
    );
  } else if (kind === "terminal") {
    steps.push(terminalStep(text));
  } else if (kind === "long_horizon") {
    const recorded = readHorizon(text);
    if (recorded.malformed) {
      steps.push("horizon: malformed record, 0 executed, not scored");
    } else if (recorded.failedAt !== null) {
      steps.push(
        `horizon: ${recorded.count} step(s) recorded, failed at ${recorded.failedAt}, 0 executed, not scored`,
      );
    } else {
      steps.push(
        `horizon: ${recorded.count} step(s) recorded, none executed, not scored`,
      );
    }
  } else if (kind === "coding") {
    const findings = staticSecurityScan(text);
    steps.push("coding: no repository write");
    if (arm.task.grader === "database") {
      const statement = text.trim();
      if (/^(select|insert|update|delete|drop)\b/i.test(statement)) {
        const parsed = parseStatement(statement);
        steps.push(`database: ${parsed.detail}, connected=${parsed.connected}`);
      } else {
        steps.push("database: no statement in the request");
      }
    } else if (arm.task.grader === "dry-run") {
      if (/\b(dry-run|deploy|provision|apply|live)\b/i.test(text)) {
        steps.push(`devops: ${dryRunPlan(text)}`);
      } else {
        steps.push("devops: no plan in the request");
      }
    } else if (arm.task.grader === "unit" && text.includes("assert:")) {
      const result = runAssertionFixture(text);
      const verdict =
        result.detail === "met"
          ? "pass"
          : result.detail === "unmet"
            ? "fail"
            : "malformed";
      steps.push(`testing: ${verdict} after run`);
    } else if (arm.task.grader === "graph" && text.includes("edges:")) {
      const edges = text.match(/edges:\S+/)?.[0] ?? "";
      steps.push(`architecture: ${dependencyCycle(edges)}`);
    } else if (arm.task.grader === "repository" && text.includes("repo:")) {
      const repo = text.match(/repo:\S+/)?.[0] ?? "";
      const verdict = classifyRepoPath(repo);
      const label =
        verdict === "refused" || verdict === "outside" || verdict === "missing"
          ? verdict
          : "inside fixture";
      steps.push(`repository: ${label}`);
    }
    if (findings.length) steps.push(`scan: ${findings.join(",")}`);
  } else if (kind === "reasoning") {
    if (/facts:/.test(text) && /query:/.test(text)) {
      const verdict = entailQuery(text);
      steps.push(`reasoning: entailment ${verdict}`);
    } else {
      const label = classifyThinking(text);
      steps.push(`reasoning: classified as ${label}`);
    }
  } else if (kind === "thinking") {
    const label = classifyThinking(text);
    steps.push(`thinking: classified as ${label}`);
  } else if (kind === "science") {
    const reaction = text.match(
      /\d*[A-Z][A-Za-z0-9]*(?:\+\d*[A-Z][A-Za-z0-9]*)*->\d*[A-Z][A-Za-z0-9]*(?:\+\d*[A-Z][A-Za-z0-9]*)*/,
    );
    if (reaction) {
      steps.push(`science: ${reactionBalance(reaction[0])}`);
    } else {
      const formula = text.match(/\b[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+\b/);
      if (formula) {
        const counts = formulaCounts(formula[0]);
        steps.push(
          counts ? `science: ${counts}` : "science: formula not parsed",
        );
      } else {
        steps.push("science: no formula in the request");
      }
    }
  } else if (kind === "research") {
    if (/https?:|id=|claim=/.test(text)) {
      const check = checkCitation(text);
      steps.push(`research: ${check.detail}, no fetch`);
    } else {
      steps.push("research: no citation in the request");
    }
  } else if (kind === "memory") {
    const ops = text.match(/(?:set:[^;\s]+|get:[^;\s]+)/g);
    if (ops) {
      steps.push(`memory: ${runMemoryFixture(ops.join(";")) || "empty"}`);
    } else {
      steps.push("memory: no fixture operation in the request");
    }
  } else if (kind === "verification") {
    const computed = independentExpected(text);
    if (computed) {
      steps.push(`verification: ${computed}`);
    } else if (text.includes("left=") && text.includes("right=")) {
      const left = text.match(/left=([^;]*)/)?.[1];
      const right = text.match(/right=([^;]*)/)?.[1];
      steps.push(`verification: ${left === right ? "same" : "different"}`);
    } else {
      steps.push("verification: no expected value in the request");
    }
  } else if (kind === "planning") {
    const recorded = readPlan(text);
    if (recorded.mode === "required") {
      steps.push(
        recorded.skipped
          ? `planning: skipped ${recorded.skipped}, 0 executed`
          : "planning: required steps recorded, 0 executed",
      );
    } else {
      steps.push(`planning: ${recorded.count} step(s) recorded, none executed`);
    }
  } else if (kind === "tool") {
    const namedText = text.trim();
    if (namedText.startsWith("tool:") || namedText.startsWith("call:")) {
      const named = nameTool(namedText);
      steps.push(`tool: ${named.status}, called=${named.called}`);
    } else {
      steps.push("tool: not named");
    }
  } else if (kind === "world") {
    if (text.includes("pos=") && text.includes("action=")) {
      steps.push(`world: ${stepWorld(text)}`);
    } else {
      steps.push("world: no step in the request");
    }
  } else if (kind === "multimodal") {
    if (text.includes("no-encoder") || text.includes("encoder:")) {
      steps.push("multimodal: no encoder in the CPU fixture");
    } else {
      steps.push("multimodal: no encoder claim in the request");
    }
  } else if (kind === "strategy") {
    if (text.includes("choose:")) {
      const choice = readStrategy(text);
      steps.push(
        choice.ok
          ? `strategy: chose ${choice.choice}, rejected ${choice.rejected}, 0 executed`
          : `strategy: ${choice.detail}, 0 executed`,
      );
    } else {
      steps.push("strategy: no choice recorded");
    }
  } else {
    steps.push(`${kind}: program arm selected`);
  }
  const note = blocked
    ? "A locked surface was requested. The step was not applied."
    : (steps[steps.length - 1] ?? "no step");
  return { armId: arm.id, kind, steps, note, blocked };
}
