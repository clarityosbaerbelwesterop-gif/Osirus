import { describe, expect, it } from "vitest";
import {
  UnconfiguredSandbox,
  unavailableResult,
} from "../src/lib/sandbox/driver";
import { commandCheck } from "../src/lib/verification/checks";
import { arbitrate, VerificationEngine } from "../src/lib/verification/engine";
import { extractFiles, syntaxCheckFor } from "../src/lib/arms/coding";
import { sandboxTools } from "../src/lib/tools/sandbox-tools";
import { needsApproval } from "../src/lib/tools/registry";

describe("unconfigured sandbox", () => {
  it("says so instead of pretending", async () => {
    const driver = new UnconfiguredSandbox("no OIDC token here");
    expect(driver.availability()).toMatchObject({
      configured: false,
      driver: null,
    });
    await expect(driver.create()).rejects.toThrow(/sandbox_not_configured/);
  });

  it("produces a null exit code, never a zero one", async () => {
    // A zero exit code would turn "we could not run your tests" into "your
    // tests passed". The verdict has to land at unverified instead.
    const result = unavailableResult("npm test", "hosted execution is off");
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("NOT_CONFIGURED");

    const verdict = await new VerificationEngine([
      commandCheck({ id: "tests", type: "TEST", required: true, result }),
    ]).run({ runId: "r", stageId: "s", objective: "o", output: {} });
    expect(verdict.status).toBe("unverified");
    expect(verdict.status).not.toBe("verified");
  });

  it("cannot be talked up to verified by model review", () => {
    expect(
      arbitrate([
        {
          id: "tests",
          type: "TEST",
          required: true,
          status: "inconclusive",
          detail: "",
          evidence: {},
          durationMs: 0,
        },
        {
          id: "review",
          type: "MODEL",
          required: false,
          status: "passed",
          detail: "",
          evidence: {},
          durationMs: 0,
        },
      ]).status,
    ).toBe("unverified");
  });
});

describe("generated code extraction", () => {
  it("pairs a code block with the path named above it", () => {
    const files = extractFiles(
      "Create `src/add.js`:\n\n```js\nmodule.exports = 1;\n```\n\nand `src/util.py`:\n\n```python\nx = 1\n```\n",
    );
    expect(files.map((file) => file.path)).toEqual([
      "src/add.js",
      "src/util.py",
    ]);
  });

  it("still returns a block that names no path", () => {
    const files = extractFiles("Here you go:\n\n```js\nconst a = 1;\n```\n");
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toMatch(/^generated\/block-1/);
  });

  it("only claims a checker for languages one exists for", () => {
    expect(syntaxCheckFor("a.js")).toEqual(["node", ["--check", "a.js"]]);
    expect(syntaxCheckFor("a.py")).toEqual([
      "python3",
      ["-m", "py_compile", "a.py"],
    ]);
    // No TypeScript checker without an install, so none is claimed.
    expect(syntaxCheckFor("a.ts")).toBeNull();
    expect(syntaxCheckFor("a.rs")).toBeNull();
  });
});

describe("sandbox tools", () => {
  const tools = sandboxTools(async () => {
    throw new Error("not needed");
  });
  const byId = new Map(tools.map((tool) => [tool.id, tool]));

  it("gates publishing a preview URL but not working inside the VM", () => {
    // Isolation is the control for reads, writes and commands. Exposing a port
    // publishes something other people can reach, which is a person's call.
    expect(needsApproval(byId.get("sandbox.run")!)).toBe(false);
    expect(needsApproval(byId.get("sandbox.write")!)).toBe(false);
    expect(needsApproval(byId.get("sandbox.preview")!)).toBe(true);
  });

  it("refuses a path that climbs out of the working directory", () => {
    const read = byId.get("sandbox.read")!;
    expect(
      read.inputSchema.safeParse({ path: "../../etc/passwd" }).success,
    ).toBe(false);
    expect(read.inputSchema.safeParse({ path: "src/app.ts" }).success).toBe(
      true,
    );
  });

  it("keeps write tools away from the research arm", () => {
    expect(byId.get("sandbox.write")!.arms).not.toContain("research");
    expect(byId.get("sandbox.read")!.arms).toContain("research");
  });
});
