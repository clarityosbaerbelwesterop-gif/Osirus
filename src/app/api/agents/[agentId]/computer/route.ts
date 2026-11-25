import { z } from "zod";
import { getAgent } from "@/lib/agents/store";
import { guardWrite, json } from "@/lib/product/api";
import { resolveSandbox } from "@/lib/sandbox";
import { sandboxErrorSummary } from "@/lib/sandbox/error-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// A bot's cloud computer as Open Terminal shows it: files, a shell and the
// running processes. Osirus calls the machine's Open Terminal from inside
// the machine (loopback only), for the bot's owner only.

const processId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const filePath = z
  .string()
  .max(1_000)
  .refine((value) => !/[\u0000-\u001f]/.test(value), "control characters");

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("files"), path: filePath.default(".") }),
  z.object({ action: z.literal("read"), path: filePath }),
  z.object({
    action: z.literal("run"),
    command: z.string().trim().min(1).max(8_000),
  }),
  z.object({ action: z.literal("processes") }),
  z.object({ action: z.literal("output"), id: processId }),
  z.object({
    action: z.literal("input"),
    id: processId,
    text: z.string().max(8_000),
  }),
  z.object({ action: z.literal("kill"), id: processId }),
]);

/** Open Terminal names its log files on the machine; the page needs none. */
function withoutLogPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLogPaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "log_path")
      .map(([key, item]) => [key, withoutLogPaths(item)]),
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  if (!z.string().uuid().safeParse(agentId).success)
    return json({ error: "invalid_request" }, 400);
  const guard = await guardWrite(request, {
    schema,
    route: "agents.computer",
    limit: 60,
    maxBytes: 20_000,
  });
  if (!guard.ok) return guard.response;
  const bot = await getAgent(guard.identity, agentId);
  if (!bot) return json({ error: "not_found" }, 404);
  const driver = await resolveSandbox();
  if (!driver.availability().configured)
    return json(
      {
        error: "computer_unavailable",
        message: "Der Cloud-Computer ist gerade nicht verfügbar.",
      },
      503,
    );
  const [
    { openComputer, saveFolder, machineGone },
    { computerName },
    terminal,
    stored,
  ] = await Promise.all([
    import("@/lib/agents/bot-computer"),
    import("@/lib/agents/bot-computer-plan"),
    import("@/lib/agents/open-terminal"),
    import("@/lib/agents/bot-computer-files"),
  ]);
  const files = stored.databaseComputerFiles(guard.identity, bot.id);
  const attempt = async () => {
    const machine = await openComputer(
      driver,
      computerName(guard.identity.workspaceId, bot.id),
      request.signal,
      files,
    );
    await terminal.ensureOpenTerminal(machine, request.signal);
    await machine.keepAlive?.(10 * 60 * 1000).catch(() => undefined);
    const body = guard.body;
    const call = (spec: Parameters<typeof terminal.callOpenTerminal>[1]) =>
      terminal.callOpenTerminal(machine, spec, request.signal);
    const result =
      body.action === "files"
        ? await call({
            method: "GET",
            path: "/files/list",
            query: { directory: body.path },
          })
        : body.action === "read"
          ? await call({
              method: "GET",
              path: "/files/read",
              query: { path: body.path },
            })
          : body.action === "run"
            ? await call({
                method: "POST",
                path: "/execute",
                query: { wait: 20 },
                body: { command: body.command },
              })
            : body.action === "processes"
              ? await call({ method: "GET", path: "/execute" })
              : body.action === "output"
                ? await call({
                    method: "GET",
                    path: `/execute/${body.id}/status`,
                    query: { wait: 0 },
                  })
                : body.action === "input"
                  ? await call({
                      method: "POST",
                      path: `/execute/${body.id}/input`,
                      body: { input: body.text },
                    })
                  : await call({
                      method: "DELETE",
                      path: `/execute/${body.id}`,
                    });
    // The machine stops on its own after a while; what a command changed
    // is kept now, not only when the chat releases the machine.
    if (
      body.action === "run" ||
      body.action === "input" ||
      body.action === "kill"
    )
      await saveFolder(machine, files).catch(() => false);
    return result;
  };
  try {
    // A chat answer deletes its machine when it ends; an action that lands
    // in that moment finds the machine gone and runs once on a fresh one,
    // which unpacks the folder the answer just saved.
    const result = await attempt().catch((error: unknown) => {
      if (request.signal.aborted || !machineGone(error)) throw error;
      return attempt();
    });
    if (result.status < 200 || result.status >= 300)
      return json(
        {
          error: "computer_refused",
          status: result.status,
          detail: result.body,
        },
        result.status === 404 ? 404 : 422,
      );
    return json({ ok: true, result: withoutLogPaths(result.body) });
  } catch (error) {
    if (request.signal.aborted) return json({ error: "cancelled" }, 499);
    console.error(
      "agents.computer failed",
      JSON.stringify(sandboxErrorSummary(error)),
    );
    return json(
      {
        error: "computer_failed",
        message:
          "Der Cloud-Computer hat nicht geantwortet. Bitte erneut versuchen.",
      },
      502,
    );
  }
}
