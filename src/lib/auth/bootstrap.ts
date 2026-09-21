import { randomUUID } from "node:crypto";
import { queryAs, querySystem } from "../db/client";

export type ProductIdentity = {
  userId: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
};

type WorkspaceRow = {
  organization_id: string;
  workspace_id: string;
  workspace_name: string;
};

export async function bootstrapProductIdentity(user: {
  id: string;
  email?: string | null;
  name?: string | null;
}): Promise<ProductIdentity> {
  await queryAs(
    user.id,
    `insert into osirus.users (id, email, display_name)
     values ($1::uuid, $2, $3)
     on conflict (id) do update
       set email = excluded.email,
           display_name = excluded.display_name,
           updated_at = now()`,
    [user.id, user.email ?? null, user.name ?? null],
  );

  const existing = await queryAs<WorkspaceRow>(
    user.id,
    `select wm.organization_id,
            wm.workspace_id,
            w.name as workspace_name
       from osirus.workspace_memberships wm
       join osirus.workspaces w on w.id = wm.workspace_id
      where wm.user_id = $1::uuid
      order by wm.created_at
      limit 1`,
    [user.id],
  );

  if (existing[0]) {
    return {
      userId: user.id,
      organizationId: existing[0].organization_id,
      workspaceId: existing[0].workspace_id,
      workspaceName: existing[0].workspace_name,
    };
  }

  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const stableSuffix = user.id.replaceAll("-", "").slice(0, 16);
  const organizationSlug = `personal-${stableSuffix}`;

  // Provisioning a user's first tenancy runs as a system caller. Every
  // statement below is parameterised by the already-authenticated user id and
  // touches only that user's rows, but it cannot run under the caller's own
  // policies: `on conflict` has to probe the target table for a conflicting
  // row, and until the membership rows exist the caller cannot see any row in
  // osirus.workspaces, so the insert is rejected outright with a row-level
  // security violation. The is_system() branches in these policies exist for
  // exactly this bootstrap. Ordinary reads and writes stay on queryAs.
  const organizations = await querySystem<{ id: string }>(
    `with inserted as (
       insert into osirus.organizations (id, name, slug, created_by)
       values ($1::uuid, $2, $3, $4::uuid)
       on conflict (slug) do nothing
       returning id
     )
     select id from inserted
     union all
     select id from osirus.organizations
      where slug = $3 and created_by = $4::uuid
     limit 1`,
    [
      organizationId,
      `${user.name ?? "Personal"} workspace`,
      organizationSlug,
      user.id,
    ],
  );
  const resolvedOrganizationId = organizations[0]?.id;
  if (!resolvedOrganizationId) {
    throw new Error("Unable to bootstrap organization");
  }

  await querySystem(
    `insert into osirus.organization_memberships (organization_id, user_id, role)
     values ($1::uuid, $2::uuid, 'owner')
     on conflict (organization_id, user_id) do nothing`,
    [resolvedOrganizationId, user.id],
  );

  const workspaces = await querySystem<{ id: string; name: string }>(
    `with inserted as (
       insert into osirus.workspaces (id, organization_id, name, slug, created_by)
       values ($1::uuid, $2::uuid, 'Personal', 'personal', $3::uuid)
       on conflict (organization_id, slug) do nothing
       returning id, name
     )
     select id, name from inserted
     union all
     select id, name from osirus.workspaces
      where organization_id = $2::uuid and slug = 'personal'
     limit 1`,
    [workspaceId, resolvedOrganizationId, user.id],
  );
  const resolvedWorkspace = workspaces[0];
  if (!resolvedWorkspace) throw new Error("Unable to bootstrap workspace");

  await querySystem(
    `insert into osirus.workspace_memberships
       (workspace_id, organization_id, user_id, role)
     values ($1::uuid, $2::uuid, $3::uuid, 'owner')
     on conflict (workspace_id, user_id) do nothing`,
    [resolvedWorkspace.id, resolvedOrganizationId, user.id],
  );

  return {
    userId: user.id,
    organizationId: resolvedOrganizationId,
    workspaceId: resolvedWorkspace.id,
    workspaceName: resolvedWorkspace.name,
  };
}
