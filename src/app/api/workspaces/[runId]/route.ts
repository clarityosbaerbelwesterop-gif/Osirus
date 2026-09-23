import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { DbWorkspaceStore } from "@/lib/coding/db-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ runId: z.string().uuid() });

/**
 * The run's coding workspace as last recorded: file tree, diff, command log,
 * preview URL. Read through row-level security -- a run the caller cannot see
 * has no workspace here, and its sandbox handle is never returned at all.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return Response.json({ error: "invalid_run_id" }, { status: 400 });

  const record = await new DbWorkspaceStore(session.user.id).load(
    parsed.data.runId,
  );
  if (!record) return Response.json({ workspace: null });
  return Response.json({
    workspace: {
      driver: record.driver,
      status: record.status,
      repository: record.repository,
      branch: record.branch,
      repositoryMap: record.repositoryMap,
      commands: record.commands.map((command) => ({
        phase: command.phase,
        command: [command.cmd, ...command.args].join(" "),
        source: command.source,
      })),
      commandLog: record.commandLog,
      fileTree: record.fileTree,
      diff: record.diff,
      previewUrl: record.previewUrl,
    },
  });
}
