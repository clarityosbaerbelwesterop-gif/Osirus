import "server-only";
import { z } from "zod";
import { queryAs } from "../db/client";
import type { ToolDefinition } from "../tools/registry";
import { repositoryRef } from "../connectors/github-tools";

// How the Rouge Agent works with the rest of the team.
//
// It can see the workspace's bots and ask one of them, by name, for its
// view; the bot answers with its own role and model, exactly as in its
// room. And it can hand a repository task to Code: the hand-off is a link
// that opens Code with repository, branch and task filled in, so the person
// starts the run there and keeps approving each step. Nothing here writes
// outside Osirus, so none of it asks for approval.

type Identity = { userId: string; organizationId: string; workspaceId: string };

const ARMS: ToolDefinition["arms"] = [
  "general",
  "thinking",
  "coding",
  "research",
  "building",
];

async function personEmail(userId: string) {
  const rows = await queryAs<{ email: string | null }>(
    userId,
    `select email from osirus.users where id = $1::uuid`,
    [userId],
  ).catch(() => []);
  return rows[0]?.email ?? null;
}

/** The Code link a hand-off produces; also used by tests. */
export function codeHandoffLink(input: {
  repository: string;
  branch?: string | null;
  task: string;
}) {
  const { owner, name } = repositoryRef(input.repository);
  const params = new URLSearchParams({ new: "1", repo: `${owner}/${name}` });
  if (input.branch?.trim()) params.set("branch", input.branch.trim());
  params.set("task", input.task.trim().slice(0, 1500));
  return `/app/coding?${params.toString()}`;
}

export function collaborationTools(identity: Identity): ToolDefinition[] {
  const workspace = { ...identity, workspaceName: "" };
  return [
    {
      id: "bots.list",
      title: "Bots des Workspace auflisten",
      summary:
        "The bots of this workspace (your teammates): name, role and whether they are active.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({}),
      run: async () => {
        const { listAgents } = await import("./store");
        const { botRole } = await import("./role");
        const bots = await listAgents(workspace);
        return {
          bots: bots.map((bot) => ({
            name: bot.name,
            role: botRole(bot.system_prompt),
            active: bot.status === "active",
          })),
        };
      },
    },
    {
      id: "bots.ask",
      title: "Einen Bot fragen",
      summary:
        "Ask one of the workspace's bots, by name, for its answer or view on a question; it replies in its own role. Use it to work with the bots the person names.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({
        bot: z.string().min(1).max(80),
        question: z.string().min(1).max(8_000),
      }),
      run: async (input) => {
        const args = input as { bot: string; question: string };
        const { listAgents } = await import("./store");
        const bots = await listAgents(workspace);
        const wanted = args.bot.trim().replace(/^@/, "").toLowerCase();
        const bot =
          bots.find((entry) => entry.name.toLowerCase() === wanted) ??
          bots.find((entry) => entry.name.toLowerCase().startsWith(wanted));
        if (!bot)
          return {
            found: false,
            available: bots.map((entry) => entry.name),
          };
        if (bot.status !== "active")
          return { found: true, bot: bot.name, paused: true };
        const { botAnswer } = await import("../gateway/answer");
        const result = await botAnswer({
          identity: workspace,
          user: { email: await personEmail(identity.userId) },
          bot: {
            id: bot.id,
            name: bot.name,
            system_prompt: bot.system_prompt,
          },
          content: `Frage des Rouge Agent im Auftrag der Person:\n\n${args.question}`,
          surface: "agent",
        });
        if ("error" in result)
          return { found: true, bot: bot.name, error: result.error };
        return { found: true, bot: bot.name, answer: result.text };
      },
    },
    {
      id: "code.handoff",
      title: "Aufgabe an Code übergeben",
      summary:
        "Prepare a task for Code (changes in a repository, run in a sandbox with tests and approval per step). Returns a link that opens Code with repository, branch and task filled in; give it to the person.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ARMS,
      inputSchema: z.object({
        repository: z.string().min(3).max(200),
        branch: z.string().max(200).optional(),
        task: z.string().min(1).max(1500),
      }),
      run: async (input) => {
        const args = input as {
          repository: string;
          branch?: string;
          task: string;
        };
        const link = codeHandoffLink(args);
        return {
          link,
          markdown: `[In Code öffnen](${link})`,
          note: "Code opens with repository, branch and task filled in; the person starts the run there.",
        };
      },
    },
  ];
}
