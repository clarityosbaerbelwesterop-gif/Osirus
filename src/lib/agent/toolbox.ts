import "server-only";
import { z } from "zod";
import type { ArmId, ArmStageContext } from "../arms/types";
import { ComputeEngine } from "../compute/engine";
import { MathjsProvider } from "../compute/mathjs-provider";
import { PythonComputeProvider } from "../compute/python-provider";
import { computeTools } from "../compute/tools";
import type { SandboxHandle } from "../sandbox/driver";
import { registryFor } from "../tools/runtime";
import type {
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from "../tools/registry";

// The tools an arm gets for one stage.
//
// Built per stage and torn down with it: a sandbox created for compute or code
// lives exactly as long as the stage that asked for it, unless a coding
// workspace explicitly keeps it. Tools that need infrastructure this
// deployment does not have are simply absent -- the model is never offered a
// tool that would fail on every call.

export type ToolEvidence = {
  toolId: string;
  input: unknown;
  ok: boolean;
  data: unknown;
  error?: string;
};

export type Toolbox = {
  registry: ToolRegistry;
  evidence: ToolEvidence[];
  record: (entry: {
    toolId: string;
    input: unknown;
    result: ToolResult;
  }) => void;
  sandboxStatus: string;
  dispose: () => Promise<void>;
};

export type ToolboxExtension = (input: {
  context: ArmStageContext;
  sandbox: () => Promise<SandboxHandle>;
  sandboxConfigured: boolean;
}) => Promise<ToolDefinition[]> | ToolDefinition[];

export async function buildToolbox(
  context: ArmStageContext,
  options: { armId: ArmId; extensions?: ToolboxExtension[] },
): Promise<Toolbox> {
  const { runtime, identity, work } = context;
  const registry = registryFor({
    repository: runtime.repository,
    actorId: identity.userId,
  });

  const { resolveSandbox } = await import("../sandbox");
  const driver = await resolveSandbox();
  const availability = driver.availability();
  let handle: SandboxHandle | null = null;
  const sandbox = async () => {
    if (!availability.configured)
      throw new Error(`sandbox_not_configured: ${availability.reason}`);
    handle ??= await driver.create({
      timeoutMs: 10 * 60 * 1000,
      // Compute needs to install sympy on first use and nothing else.
      allowedDomains: ["pypi.org", "files.pythonhosted.org"],
      signal: context.signal,
    });
    return handle;
  };

  const engine = async () =>
    new ComputeEngine(
      availability.configured
        ? [new MathjsProvider(), new PythonComputeProvider(sandbox)]
        : [new MathjsProvider()],
    );

  const memoryTool: ToolDefinition<{ query: string; limit?: number }, unknown> =
    {
      id: "memory.search",
      title: "Search memory",
      summary:
        "Search this workspace's verified memory for relevant facts, decisions and past outcomes.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: [
        "general",
        "thinking",
        "coding",
        "research",
        "math_science",
        "building",
      ],
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      run: async ({ query, limit }) => {
        const items = await runtime.memory.retrieve({
          workspaceId: work.workspaceId,
          objective: query,
          capability: work.capability,
          stage: "agent_loop",
          tokenBudget: 1200,
          limit: limit ?? 6,
        });
        return {
          items: items.map((item) => ({
            id: item.id,
            tier: item.tier,
            verification: item.verificationStatus ?? "unverified",
            content: item.content.slice(0, 1200),
          })),
        };
      },
    };

  for (const tool of [memoryTool as ToolDefinition, ...computeTools(engine)]) {
    registry.register(tool);
  }
  for (const extension of options.extensions ?? []) {
    for (const tool of await extension({
      context,
      sandbox,
      sandboxConfigured: availability.configured,
    })) {
      if (!registry.has(tool.id)) registry.register(tool);
    }
  }

  const evidence: ToolEvidence[] = [];
  return {
    registry,
    evidence,
    record: ({ toolId, input, result }) => {
      evidence.push({
        toolId,
        input,
        ok: result.ok,
        data: result.data,
        error: result.error,
      });
    },
    sandboxStatus: availability.configured
      ? String(availability.driver)
      : "NOT_CONFIGURED",
    dispose: async () => {
      await handle?.stop().catch(() => undefined);
      handle = null;
    },
  };
}
