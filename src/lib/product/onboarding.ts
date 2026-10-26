import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";

// The first steps, derived from what the workspace has actually done: no
// separate progress record that could claim a step nobody took.
export async function onboardingSteps(identity: ProductIdentity) {
  const [row] = await queryAs<{
    runs: string;
    attachments: string;
    github: boolean;
    automations: string;
  }>(
    identity.userId,
    `select
       (select count(*) from osirus.runs where workspace_id = $1::uuid) as runs,
       (select count(*) from osirus.attachments where workspace_id = $1::uuid) as attachments,
       exists (select 1 from osirus.connector_installations
                where workspace_id = $1::uuid and connector_id = 'github'
                  and status = 'active') as github,
       (select count(*) from osirus.automations where workspace_id = $1::uuid) as automations`,
    [identity.workspaceId],
  );
  if (!row) return undefined;
  return [
    {
      id: "ask",
      label: "Ask Osirus to do something",
      done: Number(row.runs) > 0,
    },
    {
      id: "attach",
      label: "Attach a file to a question",
      done: Number(row.attachments) > 0,
    },
    {
      id: "github",
      label: "Connect GitHub for your repositories",
      done: Boolean(row.github),
      href: "/app/connections",
    },
    {
      id: "automation",
      label: "Create an automation",
      done: Number(row.automations) > 0,
      href: "/app/automations",
    },
  ];
}

/** False until the person finished or skipped the introduction tour once. */
export async function tourSeen(userId: string) {
  const [row] = await queryAs<{ onboarded_at: string | null }>(
    userId,
    "select onboarded_at from osirus.users where id = $1::uuid",
    [userId],
  );
  // No row yet (first request races the bootstrap): show the tour.
  return Boolean(row?.onboarded_at);
}

/** Record the first time the tour was finished or skipped; later calls keep it. */
export async function markTourSeen(userId: string) {
  await queryAs(
    userId,
    `update osirus.users
        set onboarded_at = coalesce(onboarded_at, now())
      where id = $1::uuid`,
    [userId],
  );
}
