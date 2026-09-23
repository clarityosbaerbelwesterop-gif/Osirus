import "server-only";
import { bootstrapProductIdentity } from "../auth/bootstrap";
import { recordSecurityEvent } from "./events";

/**
 * Record that a signed-in person asked for a run that row-level security
 * would not show them (another workspace's, or one that does not exist). The
 * event goes to the requester's own workspace; nothing about the target run
 * is read or recorded beyond its id.
 */
export async function recordAccessRefused(
  user: { id: string; email?: string | null; name?: string | null },
  input: { resource: "run" | "approval"; id: string },
) {
  try {
    const identity = await bootstrapProductIdentity(user);
    await recordSecurityEvent(identity, {
      kind: "access_refused",
      severity: input.resource === "approval" ? "info" : "warning",
      summary:
        input.resource === "approval"
          ? "A decision on an approval that was already decided, had expired, or is outside this workspace was refused."
          : "A request for a run outside this workspace, or one that does not exist, was refused.",
      detail: { resource: input.resource, id: input.id },
    });
  } catch {
    // Recording is best effort; the refusal itself already happened.
  }
}
