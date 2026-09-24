import type { SandboxDriver } from "../../sandbox/driver";
import type { EvalTask } from "../types";
import { familyOf, referenceFix } from "./coding-fixtures";

// Label verification for generated tasks. A synthetic label is not truth
// until something other than a model confirms it: for coding, the buggy
// fixture must fail its tests and the reference fix must pass the visible and
// hidden tests, both run for real in a sandbox. Math labels are computed and
// arrive verified.

export async function verifyCodingLabel(
  task: EvalTask,
  sandbox: () => Promise<SandboxDriver>,
  signal?: AbortSignal,
): Promise<{ verified: boolean; evidence: Record<string, unknown> }> {
  if (task.spec.verify.kind !== "tests" || !task.spec.fixture)
    return {
      verified: false,
      evidence: { reason: "not a test-verified task" },
    };
  const family = familyOf(task);
  if (!family)
    return { verified: false, evidence: { reason: "unknown family" } };
  const driver = await sandbox();
  if (!driver.availability().configured)
    return { verified: false, evidence: { reason: "no sandbox" } };
  const handle = await driver.create({ timeoutMs: 120_000, signal });
  try {
    const dir = "label";
    await handle.writeFiles(
      task.spec.fixture.map((file) => ({
        path: `${dir}/${file.path}`,
        content: file.content,
      })),
    );
    const run = () =>
      handle.runCommand({
        cmd:
          task.spec.verify.kind === "tests"
            ? task.spec.verify.command[0]!
            : "true",
        args:
          task.spec.verify.kind === "tests"
            ? task.spec.verify.command.slice(1)
            : [],
        cwd: dir,
        timeoutMs: 60_000,
        signal,
      });
    const buggy = await run();
    await handle.writeFiles([
      ...referenceFix(family)
        .filter((file) => file.path.startsWith("src/"))
        .map((file) => ({
          path: `${dir}/${file.path}`,
          content: file.content,
        })),
      ...task.spec.verify.files.map((file) => ({
        path: `${dir}/${file.path}`,
        content: file.content,
      })),
    ]);
    const fixed = await run();
    const verified =
      buggy.exitCode !== 0 && buggy.exitCode !== null && fixed.exitCode === 0;
    return {
      verified,
      evidence: {
        basis: "reference_fix",
        buggyExitCode: buggy.exitCode,
        fixedExitCode: fixed.exitCode,
        ...(verified
          ? {}
          : { output: `${fixed.stdout}\n${fixed.stderr}`.slice(-400) }),
      },
    };
  } finally {
    await handle.destroy?.().catch(() => undefined);
    await handle.stop().catch(() => undefined);
  }
}
