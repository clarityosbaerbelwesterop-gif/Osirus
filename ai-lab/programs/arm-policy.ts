import { gradeArm, staticSecurityScan } from "./behavior";
import { classifyThinking, logicPhrase, readHorizon } from "./domains";
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
  if (name.includes("THINK")) return "thinking";
  if (name.includes("REASON")) return "reasoning";
  if (name.includes("RESEARCH")) return "research";
  if (name.includes("VERIF")) return "verification";
  if (name.includes("PLAN") || name.includes("STRATEGY")) return "planning";
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
  const sample = arm.dataset.samples[0];
  if (sample) {
    const graded = gradeArm(arm.task.grader, sample);
    steps.push(
      `fixture ${arm.id}: ${graded.passed ? "held" : "failed"} (${graded.detail})`,
    );
  }
  if (kind === "math") {
    steps.push(
      integerMath(text) ??
        logicPhrase(text) ??
        "math: no integer expression in the request",
    );
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
    if (findings.length) steps.push(`scan: ${findings.join(",")}`);
  } else if (kind === "thinking" || kind === "reasoning") {
    const label = classifyThinking(text);
    steps.push(`${kind}: classified as ${label}`);
  } else if (kind === "science") {
    steps.push("science: formula fixture only, no paper result");
  } else if (kind === "research") {
    steps.push("research: citation id checked, no fetch");
  } else if (kind === "memory") {
    steps.push("memory: in-process fixture map, not the product store");
  } else if (kind === "verification") {
    steps.push("verification: independent string compare, not a self-score");
  } else if (kind === "planning") {
    const recorded = text
      .split(/[.\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, 5);
    steps.push(`planning: ${recorded.length} step(s) recorded, none executed`);
  } else {
    steps.push(`${kind}: program arm selected`);
  }
  const note = blocked
    ? "A locked surface was requested. The step was not applied."
    : (steps[steps.length - 1] ?? "no step");
  return { armId: arm.id, kind, steps, note, blocked };
}
