import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mctsSearch, type SearchProblem } from "../gitops/lib/mcts";
import {
  dockerArgs,
  type ProcessRunner,
  runInSandbox,
} from "../gitops/lib/sandbox";
import type { SandboxSpec, SwarmPipeline } from "../gitops/lib/schema";
import {
  aggregate,
  type Candidate,
  parseCandidate,
  runSwarm,
  swarmTasks,
} from "../gitops/lib/swarm";

const SPEC: SandboxSpec = {
  image: "python:3.12-slim",
  timeoutSeconds: 10,
  memoryMb: 256,
  cpus: 1,
  pidsLimit: 64,
};

function pipeline(over: Partial<SwarmPipeline> = {}): SwarmPipeline {
  return {
    kind: "synthetic-data",
    id: "golden-tokens",
    teachers: [],
    agents: [
      { role: "author", count: 2, instructions: "i" },
      { role: "secure-coder", count: 1, instructions: "j" },
    ],
    topics: ["a", "b"],
    tasksPerAgent: 2,
    concurrency: 3,
    maxTeacherRequests: 100,
    verification: {
      sandbox: SPEC,
      prm: {
        required: true,
        endpointRef: "PRM_URL",
        apiKeyRef: "PRM_API_KEY",
        threshold: 0.7,
        aggregation: "min",
      },
    },
    dedup: { jaccardThreshold: 0.8 },
    decontamination: { ngramSize: 13, evalSources: ["x"] },
    publish: { hubRepo: "o/r", private: true },
    ...over,
  };
}

const reply = (n: number, extra: Partial<Candidate> = {}) =>
  "```json\n" +
  JSON.stringify({
    prompt: `Write function number ${n} that returns the integer ${n} times ${n} plus a distinct marker word${n}`,
    solution: `def f${n}():\n    return ${n * n}  # unique body ${"x".repeat(n)}`,
    tests: `import unittest\nfrom solution import f${n}\nclass T(unittest.TestCase):\n    def test(self):\n        self.assertEqual(f${n}(), ${n * n})`,
    steps: ["plan", "implement"],
    ...extra,
  }) +
  "\n```";

describe("agent swarm", () => {
  it("builds a deterministic task list across agent instances and topics", () => {
    const tasks = swarmTasks(pipeline());
    expect(tasks).toHaveLength(6);
    expect(tasks.map((t) => `${t.id}/${t.topic}`)).toEqual([
      "author-0-0/a",
      "author-0-1/b",
      "author-1-0/a",
      "author-1-1/b",
      "secure-coder-0-0/a",
      "secure-coder-0-1/b",
    ]);
  });

  it("accepts only verified, novel, uncontaminated, high-reward candidates and counts every rejection", async () => {
    const evalItem =
      "def leaked(): return the exact benchmark solution text that must never appear in training data at all";
    const replies: Record<string, string> = {
      "author-0-0": reply(1),
      "author-0-1": "no json here",
      "author-1-0": reply(1), // duplicate of author-0-0
      "author-1-1": reply(4, { solution: `${evalItem}\n` }),
      "secure-coder-0-0": reply(5),
      "secure-coder-0-1": reply(6),
    };
    let inFlight = 0;
    let peak = 0;
    const report = await runSwarm({
      pipeline: pipeline(),
      teacherId: "t",
      evalTexts: [evalItem],
      deps: {
        generate: async (task) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return replies[task.id];
        },
        verify: async (c) =>
          c.solution.includes("f5")
            ? { passed: false, detail: "AssertionError" }
            : { passed: true, detail: "" },
        scoreSteps: async (c) =>
          c.solution.includes("f6") ? [0.9, 0.4] : [0.9, 0.8],
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toEqual({
      malformed: 1,
      duplicate: 1,
      contaminated: 1,
      "tests-failed": 1,
      "prm-below-threshold": 1,
    });
    const [rec] = report.records;
    expect(rec.meta).toMatchObject({
      taskId: "author-0-0",
      prmScore: 0.8,
      testsPassed: true,
      teacher: "t",
    });
    expect(rec.prompt[0].role).toBe("user");
    expect(rec.completion[0].content).toContain("def f1");
  });

  it("fails closed without a required PRM and respects the teacher request budget", async () => {
    const report = await runSwarm({
      pipeline: pipeline({ maxTeacherRequests: 2 }),
      teacherId: "t",
      evalTexts: [],
      deps: {
        generate: async (t) => reply(t.id.length + Number(t.id.at(-1))),
        verify: async () => ({ passed: true, detail: "" }),
      },
    });
    expect(report.accepted).toBe(0);
    expect(report.teacherRequests).toBe(2);
    expect(report.rejected["budget-exhausted"]).toBe(4);
    expect(report.rejected["prm-unavailable"]).toBe(2);
  });

  it("rejects vacuous tests reported by the verifier", async () => {
    const report = await runSwarm({
      pipeline: pipeline({
        agents: [{ role: "author", count: 1, instructions: "i" }],
        tasksPerAgent: 1,
      }),
      teacherId: "t",
      evalTexts: [],
      deps: {
        generate: async () => reply(2),
        verify: async () => ({
          passed: false,
          reason: "vacuous-tests",
          detail: "tests pass without a solution",
        }),
      },
    });
    expect(report.rejected).toEqual({ "vacuous-tests": 1 });
  });

  it("parses fenced replies and rejects tests that never touch the solution", () => {
    expect(parseCandidate(reply(3))?.steps).toEqual(["plan", "implement"]);
    expect(
      parseCandidate(
        reply(3, {
          tests: "import unittest\nclass T(unittest.TestCase): pass",
        }),
      ),
    ).toBeNull();
    expect(aggregate([0.9, 0.5, 0.7], "min")).toBe(0.5);
    expect(aggregate([0.9, 0.5, 0.7], "last")).toBe(0.7);
  });
});

describe("test-time compute (PRM-guided MCTS)", () => {
  // Build the digit string "4217"; the PRM rewards the correct prefix length.
  const target = "4217";
  const problem: SearchProblem<string> & { scoredCalls: number } = {
    scoredCalls: 0,
    async expand(s, k) {
      return ["1", "2", "4", "7", "9"].slice(0, k).map((d) => s + d);
    },
    async score(s) {
      this.scoredCalls++;
      let ok = 0;
      while (ok < s.length && s[ok] === target[ok]) ok++;
      return ok === s.length ? (s.length + 1) / (target.length + 1) : 0;
    },
    isTerminal: (s) => s.length === target.length,
  };

  it("finds the solution with far fewer PRM calls than exhaustive search", async () => {
    const res = await mctsSearch(problem, "", {
      maxRollouts: 100,
      maxDepth: 4,
      branching: 5,
      exploration: 1.4,
    });
    expect(res.best).toBe(target);
    expect(res.terminal).toBe(true);
    expect(res.value).toBe(1);
    expect(res.scored).toBeLessThan((5 + 25 + 125 + 625) / 4);
  });

  it("spends fewer PRM calls with less exploration when the PRM is sharp", async () => {
    const res = await mctsSearch(problem, "", {
      maxRollouts: 100,
      maxDepth: 4,
      branching: 5,
      exploration: 0.3,
    });
    expect(res.best).toBe(target);
    expect(res.scored).toBeLessThanOrEqual(61);
  });

  it("returns the best partial answer when the budget runs out", async () => {
    const res = await mctsSearch(problem, "", {
      maxRollouts: 3,
      maxDepth: 4,
      branching: 5,
      exploration: 1.4,
    });
    expect(res.simulations).toBe(3);
    expect(target.startsWith(res.best)).toBe(true);
    expect(res.terminal).toBe(false);
  });
});

describe("sandbox", () => {
  it("runs every candidate without network, privileges, or writable mounts", () => {
    const args = dockerArgs(SPEC, "/tmp/x", "c1", ["python", "-m", "unittest"]);
    const pairs = args.slice(0, -6).join(" ");
    for (const flag of [
      "--network none",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--pids-limit 64",
      "--memory 256m",
      "--memory-swap 256m",
      "--user 65534:65534",
      "--volume /tmp/x:/work:ro",
    ]) {
      expect(pairs).toContain(flag);
    }
    expect(args.slice(-7)).toEqual([
      "python:3.12-slim",
      "timeout",
      "--kill-after=2",
      "10",
      "python",
      "-m",
      "unittest",
    ]);
    expect(() => dockerArgs(SPEC, "relative", "c", [])).toThrow();
  });

  it("writes only the candidate files and removes them afterwards", async () => {
    let seenDir = "";
    const runner: ProcessRunner = async (args) => {
      seenDir = args[args.indexOf("--volume") + 1].split(":")[0];
      expect(existsSync(`${seenDir}/solution.py`)).toBe(true);
      return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
    };
    await runInSandbox(SPEC, { "solution.py": "x = 1\n" }, ["true"], runner);
    expect(existsSync(seenDir)).toBe(false);
    await expect(
      runInSandbox(SPEC, { "../escape.py": "" }, ["true"], runner),
    ).rejects.toThrow(/refusing/);
  });

  // Needs a Docker daemon and the image: GITOPS_DOCKER_TESTS=1 npx vitest run ai-lab/tests/gitops-runtime.test.ts
  it.runIf(process.env.GITOPS_DOCKER_TESTS === "1")(
    "isolates real containers",
    { timeout: 120_000 },
    async () => {
      const pass = await runInSandbox(
        SPEC,
        {
          "solution.py": "def f():\n    return 2\n",
          "test_solution.py":
            "import unittest\nfrom solution import f\nclass T(unittest.TestCase):\n    def test(self):\n        self.assertEqual(f(), 2)\n",
        },
        ["python", "-B", "-m", "unittest", "-q", "test_solution"],
      );
      expect(pass.exitCode).toBe(0);
      const net = await runInSandbox(
        SPEC,
        {
          "n.py":
            "import socket\nsocket.create_connection(('1.1.1.1', 53), timeout=3)\n",
        },
        ["python", "-B", "n.py"],
      );
      expect(net.exitCode).not.toBe(0);
      const write = await runInSandbox(
        SPEC,
        { "w.py": "open('/work/x', 'w').write('x')\n" },
        ["python", "-B", "w.py"],
      );
      expect(write.stderr).toMatch(/Read-only file system/);
      const slow = await runInSandbox(
        { ...SPEC, timeoutSeconds: 2 },
        { "s.py": "while True: pass\n" },
        ["python", "-B", "s.py"],
      );
      expect(slow.timedOut).toBe(true);
    },
  );
});
