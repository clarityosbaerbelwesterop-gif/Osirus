-- Workspace memberships stay inside their organization.
--
-- Audit 2026-11-17: workspace_memberships_insert checked only that the
-- caller manages the row's organization_id. The row's workspace_id was not
-- tied to that organization, and every person owns their personal
-- organization, so a row (organization_id = mine, workspace_id = anyone's)
-- passed the policy and would have made the caller a member of another
-- tenant's workspace. The app never inserted such a row (both inserts run
-- with server-side ids), so nothing was exposed; this closes it in the
-- database, where it belongs, before invitations exist.
--
-- The update policy let an editor change their own row to 'owner' or move
-- it to another organization. Membership rows are changed by owners only,
-- and the workspace must belong to the row's organization.

CREATE OR REPLACE FUNCTION osirus.workspace_in_organization(
  target_workspace_id uuid,
  target_organization_id uuid
)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM osirus.workspaces workspace
    WHERE workspace.id = target_workspace_id
      AND workspace.organization_id = target_organization_id
  );
$function$;

-- SECURITY DEFINER so the policy on workspace_memberships can ask about
-- workspace_memberships without recursing into its own policy.
CREATE OR REPLACE FUNCTION osirus.owns_workspace(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT osirus.is_system() OR EXISTS (
    SELECT 1
    FROM osirus.workspace_memberships membership
    WHERE membership.workspace_id = target_workspace_id
      AND membership.user_id = osirus.current_user_id()
      AND membership.role = 'owner'
  );
$function$;

REVOKE ALL ON FUNCTION osirus.workspace_in_organization(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION osirus.workspace_in_organization(uuid, uuid) TO osirus_app;
REVOKE ALL ON FUNCTION osirus.owns_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION osirus.owns_workspace(uuid) TO osirus_app;

DROP POLICY IF EXISTS workspace_memberships_insert ON osirus.workspace_memberships;
CREATE POLICY workspace_memberships_insert ON osirus.workspace_memberships
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    osirus.can_manage_organization(organization_id)
    AND osirus.workspace_in_organization(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS workspace_memberships_update ON osirus.workspace_memberships;
CREATE POLICY workspace_memberships_update ON osirus.workspace_memberships
  AS PERMISSIVE FOR UPDATE TO public
  USING (osirus.owns_workspace(workspace_id))
  WITH CHECK (
    osirus.owns_workspace(workspace_id)
    AND osirus.workspace_in_organization(workspace_id, organization_id)
  );
