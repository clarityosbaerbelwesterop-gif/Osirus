// Why a command failed, and what to do about it.
//
// The engineering loop's repair step is only as good as its reading of the
// failure. "The tests failed" leads to a random edit; "TS2345 in
// src/api.ts:41, argument type mismatch" leads to opening that file at that
// line. The classes are ordered by what they rule out: an environment or
// network failure says nothing about the code, and repairing code in response
// to one is how an agent talks itself into a wrong fix.

export type FailureClass =
  | "syntax"
  | "type"
  | "assertion"
  | "logic"
  | "dependency"
  | "environment"
  | "permission"
  | "network"
  | "configuration"
  | "flaky";

export type FailureAnalysis = {
  failureClass: FailureClass;
  /** Whether a code change in this repository can fix it. */
  repairable: boolean;
  /** Whether re-running unchanged is a reasonable first step. */
  retry: boolean;
  confidence: number;
  evidence: string;
  location: { file: string; line: number | null } | null;
  strategy: string;
};

type Rule = {
  failureClass: FailureClass;
  pattern: RegExp;
  confidence: number;
};

// Order matters: the first matching rule wins.
const RULES: Rule[] = [
  {
    failureClass: "environment",
    pattern:
      /command not found|spawn \S+ ENOENT|not recognized as an internal|No such file or directory.*\b(python3?|node|npm|cargo|go)\b|requires? (node|python) (version )?[<>=]|Unsupported engine|EBADENGINE/i,
    confidence: 0.85,
  },
  {
    failureClass: "network",
    pattern:
      /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|Could not resolve host|network is unreachable|Failed to establish a new connection|403 Forbidden.*registry/i,
    confidence: 0.85,
  },
  {
    failureClass: "permission",
    pattern: /EACCES|EPERM|Permission denied|Operation not permitted/i,
    confidence: 0.8,
  },
  {
    failureClass: "dependency",
    pattern:
      /Cannot find module|Module not found|ModuleNotFoundError|No module named|ERESOLVE|unable to resolve dependency|could not resolve|unresolved import|Cannot find package|peer dep|ImportError/i,
    confidence: 0.8,
  },
  {
    failureClass: "syntax",
    pattern:
      /SyntaxError|Unexpected token|ParseError|IndentationError|TabError|error TS1\d{3}|expected .* found|Unterminated/i,
    confidence: 0.85,
  },
  {
    failureClass: "type",
    pattern:
      /error TS\d{4}|Type '.*' is not assignable|Property '.*' does not exist on type|: error: .*\[(arg-type|attr-defined|assignment|return-value)\]|mismatched types|incompatible types/i,
    confidence: 0.85,
  },
  {
    failureClass: "configuration",
    pattern:
      /Invalid configuration|Invalid options object|Unknown compiler option|config file .* not found|Missing required env|Missing script:|No test files found|no tests ran|Cannot read config/i,
    confidence: 0.7,
  },
  {
    failureClass: "assertion",
    pattern:
      /AssertionError|assert(ion)? failed|Expected:?\s.*\n?.*Received|expected .* to (equal|be|deeply equal|contain)|FAILED .*::|✗|×\s|\bFAIL\b/i,
    confidence: 0.75,
  },
  {
    failureClass: "flaky",
    pattern:
      /Timeout of \d+ms exceeded|Test timed out|exceeded timeout|flaky|intermittent|ECONNRESET during test/i,
    confidence: 0.5,
  },
];

const STRATEGY: Record<FailureClass, string> = {
  syntax:
    "Open the file at the reported line, fix the syntax error, and re-run the same command before anything else.",
  type: "Read the reported type error and the declarations it names; change the call site or the type, not both at once. Re-run the typecheck.",
  assertion:
    "Read the failing test and the code it exercises. Decide whether the code or the expectation is wrong from the task, not from which is easier to change.",
  logic:
    "Reproduce with the smallest failing case, inspect the values involved, then change the code path the failure runs through.",
  dependency:
    "Check the manifest and lockfile. Install the declared dependencies before changing code; add a dependency only when the task needs it.",
  environment:
    "The toolchain is missing or the wrong version. This is not a code defect; report it rather than editing code.",
  permission:
    "The command lacks permission in this workspace. Do not work around it with a different path; report it.",
  network:
    "The workspace could not reach a host. Network access is limited by policy; report which host rather than retrying repeatedly.",
  configuration:
    "Read the configuration file the error names and compare it with what the command expects. Fix the configuration, not the source.",
  flaky:
    "Re-run once unchanged. If it fails the same way twice it is not flaky; analyse it as a real failure.",
};

const LOCATION =
  /((?:[\w@.-]+\/)*[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|vue|svelte))(?:[:(](\d+))?/;

function firstMatchingLine(text: string, pattern: RegExp) {
  for (const line of text.split("\n")) {
    if (pattern.test(line)) return line.trim().slice(0, 300);
  }
  const match = text.match(pattern);
  return match ? match[0].slice(0, 300) : "";
}

export function analyzeFailure(result: {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}): FailureAnalysis | null {
  if (result.exitCode === 0) return null;
  const output = `${result.stderr}\n${result.stdout}`.slice(-40_000);

  if (result.exitCode === null && (result.timedOut || output.trim() === "")) {
    return {
      failureClass: "flaky",
      repairable: false,
      retry: true,
      confidence: 0.4,
      evidence: "The command did not finish (no exit code).",
      location: null,
      strategy: STRATEGY.flaky,
    };
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(output)) continue;
    const evidence = firstMatchingLine(output, rule.pattern);
    const locationMatch =
      evidence.match(LOCATION) ??
      output
        .split("\n")
        .find((line) => LOCATION.test(line) && !/node_modules/.test(line))
        ?.match(LOCATION) ??
      null;
    return {
      failureClass: rule.failureClass,
      repairable: !["environment", "network", "permission"].includes(
        rule.failureClass,
      ),
      retry: rule.failureClass === "flaky" || rule.failureClass === "network",
      confidence: rule.confidence,
      evidence,
      location: locationMatch
        ? {
            file: locationMatch[1]!,
            line: locationMatch[2] ? Number(locationMatch[2]) : null,
          }
        : null,
      strategy: STRATEGY[rule.failureClass],
    };
  }

  // A non-zero exit with no recognisable signature: most often a runtime error
  // in the code under test.
  const errorLine = firstMatchingLine(
    output,
    /Error|Exception|panic|Traceback/,
  );
  const locationMatch = output.match(LOCATION);
  return {
    failureClass: "logic",
    repairable: true,
    retry: false,
    confidence: errorLine ? 0.55 : 0.3,
    evidence: errorLine || output.trim().split("\n").slice(-3).join(" | "),
    location: locationMatch
      ? {
          file: locationMatch[1]!,
          line: locationMatch[2] ? Number(locationMatch[2]) : null,
        }
      : null,
    strategy: STRATEGY.logic,
  };
}
