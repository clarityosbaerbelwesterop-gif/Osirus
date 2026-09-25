import "server-only";
import { z } from "zod";
import { attachmentIdsOf } from "../strategy/runtime";
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
  /** How the offered tools have behaved in this workspace. A hint only. */
  performance: string[];
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
  const registry =
    runtime.stores?.registry?.() ??
    registryFor({
      repository: runtime.repository,
      actorId: identity.userId,
    });

  // M43: generated tool candidates, only when the run's policy names them.
  const { policyOfStage } = await import("../strategy/runtime");
  const generatedIds =
    policyOfStage(work.stageInput).genome.tools?.include ?? [];
  if (generatedIds.length) {
    const loader =
      runtime.stores?.generatedTools?.() ??
      (
        await import("../intelligence/synthesis/generated-tools")
      ).foundryToolLoader(options.armId);
    for (const tool of await loader(generatedIds).catch(() => []))
      if (!registry.has(tool.id)) registry.register(tool);
  }

  // M40: external actions run at most once per run, across crashes.
  const { missionLedger } = await import("../arms/horizon-runtime");
  registry.useLedger(await missionLedger(context).catch(() => null));

  const driver = runtime.stores?.sandbox
    ? await runtime.stores.sandbox()
    : await (await import("../sandbox")).resolveSandbox();
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

  // MCP tools the workspace reviewed and enabled. Always external and high
  // risk, so every call goes through the approval gate. Skipped for injected
  // stores (the arena), which run without a database.
  if (!runtime.stores) {
    try {
      const { mcpToolsForWorkspace } = await import("../connectors/mcp-store");
      for (const tool of await mcpToolsForWorkspace(identity)) {
        if (!registry.has(tool.id)) registry.register(tool);
      }
    } catch {
      // No MCP tools this run: the table is missing or unreachable.
    }
    // Read-only tools of the platforms this workspace connected by token.
    try {
      const { platformToolsForWorkspace } =
        await import("../connectors/platform");
      for (const tool of await platformToolsForWorkspace({
        ...identity,
        workspaceName: "",
      })) {
        if (!registry.has(tool.id)) registry.register(tool);
      }
    } catch {
      // No platform tools this run.
    }
  }

  // What this workspace's runs have established: repositories and their
  // stack, research claims with their sources and open uncertainties.
  // Derived on demand; skipped without a database (the arena).
  if (!runtime.stores)
    registry.register({
      id: "world.query",
      title: "Query the workspace's world model",
      summary:
        "Repositories this workspace worked on (languages, frameworks, CI) and research claims with supporting or contradicting sources, plus open uncertainties.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ["general", "thinking", "coding", "research", "building"],
      inputSchema: z.object({
        about: z.string().max(200).optional(),
      }),
      run: async (input) => {
        const { buildWorldModel } = await import("../world/model");
        return buildWorldModel(identity, {
          about: (input as { about?: string }).about,
          limit: 40,
        });
      },
    } as ToolDefinition);

  // Files attached to this run: searchable beyond what retrieval put in the
  // context, still by relevance and still as untrusted content.
  const attached = attachmentIdsOf(work.stageInput);
  if (attached.length && runtime.attachments) {
    const attachments = runtime.attachments;
    registry.register({
      id: "attachments.search",
      title: "Search the attached files",
      summary:
        "Find the passages of the files attached to this request that match a query (with file name and page or rows).",
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
      inputSchema: z.object({ query: z.string().min(1).max(500) }),
      run: async (input) => ({
        passages: await attachments.retrieve({
          ids: attached,
          query: (input as { query: string }).query,
          maxChars: 6_000,
        }),
      }),
    } as ToolDefinition);
  }

  // Tool track record from the audit table. Routing input for the model and
  // nothing else: permissions and approvals are decided by the registry.
  let performance: string[] = [];
  try {
    const { queryAs } = await import("../db/client");
    const { TOOL_PERFORMANCE_SQL, toolStats, performanceHints } =
      await import("../tools/performance");
    const rows = await queryAs<import("../tools/performance").ToolCallRow>(
      identity.userId,
      TOOL_PERFORMANCE_SQL,
      [identity.workspaceId],
    );
    performance = performanceHints(
      toolStats(rows),
      registry.profileFor(options.armId).map((tool) => tool.id),
    );
  } catch {
    performance = [];
  }

  const evidence: ToolEvidence[] = [];
  return {
    performance,
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
