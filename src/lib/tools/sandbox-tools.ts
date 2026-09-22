import { z } from "zod";
import { isSafeRelativePath, type SandboxHandle } from "../sandbox";
import type { ToolDefinition } from "./registry";

// Sandbox tools.
//
// Effects are declared honestly, and that declaration is what decides whether
// a call needs approval. Reading and writing inside an isolated VM changes
// nothing anybody else can see, so neither is gated. Running a command is
// medium risk and ungated for the same reason -- the isolation is the control,
// not a prompt. Exposing a port is external, because it publishes a URL that
// anyone holding it can reach, so it is gated.

// A traversal out of the working directory is refused here as well as by the
// sandbox, because a tool that accepts it and relies on something downstream
// to catch it is one refactor away from not being checked at all.
const pathSchema = z.string().refine(isSafeRelativePath, {
  message: "path_traversal_refused",
});

export function sandboxTools(handle: () => Promise<SandboxHandle>) {
  const write: ToolDefinition<
    { files: Array<{ path: string; content: string }> },
    { written: number }
  > = {
    id: "sandbox.write",
    title: "Write files",
    summary: "Write files into the sandbox working directory.",
    trust: "builtin",
    effect: "write",
    risk: "low",
    arms: ["coding", "building"],
    inputSchema: z.object({
      files: z
        .array(
          z.object({
            path: pathSchema,
            content: z.string().max(1_000_000),
          }),
        )
        .min(1)
        .max(50),
    }),
    run: async (input) => {
      const sandbox = await handle();
      await sandbox.writeFiles(input.files);
      return { written: input.files.length };
    },
  };

  const read: ToolDefinition<{ path: string }, { content: string | null }> = {
    id: "sandbox.read",
    title: "Read a file",
    summary: "Read one file from the sandbox.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding", "building", "research"],
    inputSchema: z.object({ path: pathSchema }),
    run: async (input) => ({
      content: await (await handle()).readFile(input.path),
    }),
  };

  const list: ToolDefinition<{ path: string }, { entries: string[] }> = {
    id: "sandbox.list",
    title: "List a directory",
    summary: "List the entries of one directory in the sandbox.",
    trust: "builtin",
    effect: "read",
    risk: "low",
    arms: ["coding", "building", "research"],
    inputSchema: z.object({ path: pathSchema }),
    run: async (input) => ({
      entries: await (await handle()).listFiles(input.path),
    }),
  };

  const run: ToolDefinition<
    { cmd: string; args?: string[]; cwd?: string; timeoutMs?: number },
    { exitCode: number | null; stdout: string; stderr: string }
  > = {
    id: "sandbox.run",
    title: "Run a command",
    summary: "Run one command in the sandbox and return its exit code.",
    trust: "builtin",
    effect: "write",
    risk: "medium",
    arms: ["coding", "building"],
    inputSchema: z.object({
      cmd: z.string().min(1).max(200),
      args: z.array(z.string().max(2000)).max(64).optional(),
      cwd: pathSchema.optional(),
      timeoutMs: z.number().int().min(1000).max(300_000).optional(),
    }),
    run: async (input, context) => {
      const result = await (
        await handle()
      ).runCommand({ ...input, signal: context.signal });
      return {
        exitCode: result.exitCode,
        // Bounded because this goes back into a prompt. The tail is what
        // carries the failure.
        stdout: result.stdout.slice(-8000),
        stderr: result.stderr.slice(-8000),
      };
    },
  };

  const preview: ToolDefinition<{ port: number }, { url: string | null }> = {
    id: "sandbox.preview",
    title: "Expose a preview URL",
    summary: "Return the public URL of a port exposed by the sandbox.",
    trust: "builtin",
    // Publishing a URL puts something where other people can reach it, which
    // is a decision for a person rather than for the arm that wants it.
    effect: "external",
    risk: "medium",
    arms: ["coding", "building"],
    inputSchema: z.object({ port: z.number().int().min(1024).max(65535) }),
    run: async (input) => ({ url: (await handle()).previewUrl(input.port) }),
  };

  return [write, read, list, run, preview];
}
