-- Security helpers, FORCE RLS, policies and update triggers recovered from verification.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION osirus.can_access_organization(target_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT osirus.is_system() OR EXISTS (
    SELECT 1
    FROM osirus.organization_memberships membership
    WHERE membership.organization_id = target_organization_id
      AND membership.user_id = osirus.current_user_id()
  );
$function$

CREATE OR REPLACE FUNCTION osirus.can_access_run(target_run_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT osirus.is_system() OR EXISTS (
    SELECT 1
    FROM osirus.runs run
    JOIN osirus.workspace_memberships membership ON membership.workspace_id = run.workspace_id
    WHERE run.id = target_run_id
      AND membership.user_id = osirus.current_user_id()
  );
$function$

CREATE OR REPLACE FUNCTION osirus.can_access_workspace(target_workspace_id uuid)
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
  );
$function$

CREATE OR REPLACE FUNCTION osirus.can_manage_organization(target_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT osirus.is_system() OR EXISTS (
    SELECT 1
    FROM osirus.organization_memberships membership
    WHERE membership.organization_id = target_organization_id
      AND membership.user_id = osirus.current_user_id()
      AND membership.role IN ('owner', 'admin')
  );
$function$

CREATE OR REPLACE FUNCTION osirus.can_manage_run(target_run_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'osirus', 'pg_catalog'
AS $function$
  SELECT osirus.is_system() OR EXISTS (
    SELECT 1
    FROM osirus.runs run
    LEFT JOIN osirus.workspace_memberships membership
      ON membership.workspace_id = run.workspace_id
      AND membership.user_id = osirus.current_user_id()
    WHERE run.id = target_run_id
      AND (
        run.requested_by = osirus.current_user_id()
        OR membership.role IN ('owner', 'editor')
      )
  );
$function$

CREATE OR REPLACE FUNCTION osirus.can_manage_workspace(target_workspace_id uuid)
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
      AND membership.role IN ('owner', 'editor')
  );
$function$

CREATE OR REPLACE FUNCTION osirus.current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$function$

CREATE OR REPLACE FUNCTION osirus.is_system()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(current_setting('app.osirus_system', true), '') = 'true';
$function$

CREATE OR REPLACE FUNCTION osirus.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


ALTER TABLE osirus.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.capability_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.capability_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.connector_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.connector_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.connector_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.connector_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.eval_results FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.eval_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_embeddings FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_items FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.memory_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.model_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_events FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.run_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.runs FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.skill_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.tool_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.usage_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.users FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.workspace_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE osirus.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE osirus.workspaces FORCE ROW LEVEL SECURITY;

CREATE POLICY approvals_access ON osirus.approvals AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY artifacts_access ON osirus.artifacts AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY capability_runs_access ON osirus.capability_runs AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY checkpoints_access ON osirus.checkpoints AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY connector_grants_access ON osirus.connector_grants AS PERMISSIVE FOR ALL TO public USING ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id))));
CREATE POLICY connector_installations_access ON osirus.connector_installations AS PERMISSIVE FOR ALL TO public USING ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id))));
CREATE POLICY eval_results_access ON osirus.eval_results AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM osirus.eval_runs evaluation
  WHERE ((evaluation.id = eval_results.eval_run_id) AND (osirus.is_system() OR ((evaluation.workspace_id IS NOT NULL) AND osirus.can_access_workspace(evaluation.workspace_id)) OR ((evaluation.workspace_id IS NULL) AND (evaluation.organization_id IS NOT NULL) AND osirus.can_manage_organization(evaluation.organization_id))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM osirus.eval_runs evaluation
  WHERE ((evaluation.id = eval_results.eval_run_id) AND (osirus.is_system() OR ((evaluation.workspace_id IS NOT NULL) AND osirus.can_manage_workspace(evaluation.workspace_id)) OR ((evaluation.workspace_id IS NULL) AND (evaluation.organization_id IS NOT NULL) AND osirus.can_manage_organization(evaluation.organization_id)))))));
CREATE POLICY eval_runs_access ON osirus.eval_runs AS PERMISSIVE FOR ALL TO public USING ((osirus.is_system() OR ((workspace_id IS NOT NULL) AND osirus.can_access_workspace(workspace_id)) OR ((workspace_id IS NULL) AND (organization_id IS NOT NULL) AND osirus.can_manage_organization(organization_id)))) WITH CHECK ((osirus.is_system() OR ((workspace_id IS NOT NULL) AND osirus.can_manage_workspace(workspace_id)) OR ((workspace_id IS NULL) AND (organization_id IS NOT NULL) AND osirus.can_manage_organization(organization_id))));
CREATE POLICY memory_embeddings_access ON osirus.memory_embeddings AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM osirus.memory_items item
  WHERE ((item.id = memory_embeddings.memory_item_id) AND ((item.owner_id = osirus.current_user_id()) OR osirus.is_system()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM osirus.memory_items item
  WHERE ((item.id = memory_embeddings.memory_item_id) AND ((item.owner_id = osirus.current_user_id()) OR osirus.is_system())))));
CREATE POLICY memory_entities_access ON osirus.memory_entities AS PERMISSIVE FOR ALL TO public USING ((osirus.is_system() OR (owner_id = osirus.current_user_id()) OR ((workspace_id IS NOT NULL) AND osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.is_system() OR ((owner_id = osirus.current_user_id()) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id)))));
CREATE POLICY memory_items_delete ON osirus.memory_items AS PERMISSIVE FOR DELETE TO public USING ((owner_id = osirus.current_user_id()));
CREATE POLICY memory_items_insert ON osirus.memory_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((osirus.is_system() OR ((owner_id = osirus.current_user_id()) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id)))));
CREATE POLICY memory_items_read ON osirus.memory_items AS PERMISSIVE FOR SELECT TO public USING ((osirus.is_system() OR (owner_id = osirus.current_user_id()) OR ((workspace_id IS NOT NULL) AND osirus.can_access_workspace(workspace_id))));
CREATE POLICY memory_items_update ON osirus.memory_items AS PERMISSIVE FOR UPDATE TO public USING ((owner_id = osirus.current_user_id())) WITH CHECK ((owner_id = osirus.current_user_id()));
CREATE POLICY memory_relations_access ON osirus.memory_relations AS PERMISSIVE FOR ALL TO public USING ((osirus.is_system() OR (owner_id = osirus.current_user_id()) OR ((workspace_id IS NOT NULL) AND osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.is_system() OR ((owner_id = osirus.current_user_id()) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id)))));
CREATE POLICY memory_summaries_access ON osirus.memory_summaries AS PERMISSIVE FOR ALL TO public USING ((osirus.is_system() OR (owner_id = osirus.current_user_id()) OR ((workspace_id IS NOT NULL) AND osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.is_system() OR ((owner_id = osirus.current_user_id()) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id)))));
CREATE POLICY messages_delete ON osirus.messages AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_workspace(workspace_id));
CREATE POLICY messages_insert ON osirus.messages AS PERMISSIVE FOR INSERT TO public WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY messages_read ON osirus.messages AS PERMISSIVE FOR SELECT TO public USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY messages_update ON osirus.messages AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY model_calls_access ON osirus.model_calls AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY organization_memberships_delete ON osirus.organization_memberships AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_organization(organization_id));
CREATE POLICY organization_memberships_insert ON osirus.organization_memberships AS PERMISSIVE FOR INSERT TO public WITH CHECK ((osirus.is_system() OR osirus.can_manage_organization(organization_id) OR (EXISTS ( SELECT 1
   FROM osirus.organizations organization
  WHERE ((organization.id = organization_memberships.organization_id) AND (organization.created_by = osirus.current_user_id()))))));
CREATE POLICY organization_memberships_read ON osirus.organization_memberships AS PERMISSIVE FOR SELECT TO public USING ((osirus.is_system() OR (user_id = osirus.current_user_id())));
CREATE POLICY organization_memberships_update ON osirus.organization_memberships AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_organization(organization_id)) WITH CHECK (osirus.can_manage_organization(organization_id));
CREATE POLICY organizations_delete ON osirus.organizations AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_organization(id));
CREATE POLICY organizations_insert ON osirus.organizations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((osirus.is_system() OR (created_by = osirus.current_user_id())));
CREATE POLICY organizations_read ON osirus.organizations AS PERMISSIVE FOR SELECT TO public USING ((osirus.can_access_organization(id) OR (created_by = osirus.current_user_id())));
CREATE POLICY organizations_update ON osirus.organizations AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_organization(id)) WITH CHECK (osirus.can_manage_organization(id));
CREATE POLICY run_attempts_access ON osirus.run_attempts AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY run_events_access ON osirus.run_events AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY run_stages_access ON osirus.run_stages AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_run(run_id)) WITH CHECK (osirus.can_manage_run(run_id));
CREATE POLICY runs_delete ON osirus.runs AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_run(id));
CREATE POLICY runs_insert ON osirus.runs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((osirus.can_manage_workspace(workspace_id) AND (requested_by = osirus.current_user_id())));
CREATE POLICY runs_read ON osirus.runs AS PERMISSIVE FOR SELECT TO public USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY runs_update ON osirus.runs AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_run(id)) WITH CHECK (osirus.can_manage_run(id));
CREATE POLICY sessions_delete ON osirus.sessions AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_workspace(workspace_id));
CREATE POLICY sessions_insert ON osirus.sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((osirus.can_manage_workspace(workspace_id) AND (created_by = osirus.current_user_id())));
CREATE POLICY sessions_read ON osirus.sessions AS PERMISSIVE FOR SELECT TO public USING (osirus.can_access_workspace(workspace_id));
CREATE POLICY sessions_update ON osirus.sessions AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY skill_definitions_system_only ON osirus.skill_definitions AS PERMISSIVE FOR ALL TO public USING (osirus.is_system()) WITH CHECK (osirus.is_system());
CREATE POLICY skill_usage_access ON osirus.skill_usage AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY skill_versions_system_only ON osirus.skill_versions AS PERMISSIVE FOR ALL TO public USING (osirus.is_system()) WITH CHECK (osirus.is_system());
CREATE POLICY tool_calls_access ON osirus.tool_calls AS PERMISSIVE FOR ALL TO public USING (osirus.can_access_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY usage_ledger_access ON osirus.usage_ledger AS PERMISSIVE FOR ALL TO public USING ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_access_workspace(workspace_id)))) WITH CHECK ((osirus.can_manage_organization(organization_id) AND ((workspace_id IS NULL) OR osirus.can_manage_workspace(workspace_id))));
CREATE POLICY users_self ON osirus.users AS PERMISSIVE FOR ALL TO public USING ((osirus.is_system() OR (id = osirus.current_user_id()))) WITH CHECK ((osirus.is_system() OR (id = osirus.current_user_id())));
CREATE POLICY workspace_memberships_delete ON osirus.workspace_memberships AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_workspace(workspace_id));
CREATE POLICY workspace_memberships_insert ON osirus.workspace_memberships AS PERMISSIVE FOR INSERT TO public WITH CHECK (osirus.can_manage_organization(organization_id));
CREATE POLICY workspace_memberships_read ON osirus.workspace_memberships AS PERMISSIVE FOR SELECT TO public USING ((osirus.is_system() OR (user_id = osirus.current_user_id())));
CREATE POLICY workspace_memberships_update ON osirus.workspace_memberships AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_workspace(workspace_id)) WITH CHECK (osirus.can_manage_workspace(workspace_id));
CREATE POLICY workspaces_delete ON osirus.workspaces AS PERMISSIVE FOR DELETE TO public USING (osirus.can_manage_workspace(id));
CREATE POLICY workspaces_insert ON osirus.workspaces AS PERMISSIVE FOR INSERT TO public WITH CHECK (osirus.can_manage_organization(organization_id));
CREATE POLICY workspaces_read ON osirus.workspaces AS PERMISSIVE FOR SELECT TO public USING (osirus.can_access_workspace(id));
CREATE POLICY workspaces_update ON osirus.workspaces AS PERMISSIVE FOR UPDATE TO public USING (osirus.can_manage_workspace(id)) WITH CHECK (osirus.can_manage_workspace(id));

CREATE TRIGGER capability_runs_touch_updated_at BEFORE UPDATE ON osirus.capability_runs FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER connector_installations_touch_updated_at BEFORE UPDATE ON osirus.connector_installations FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER memory_entities_touch_updated_at BEFORE UPDATE ON osirus.memory_entities FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER memory_items_touch_updated_at BEFORE UPDATE ON osirus.memory_items FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER memory_summaries_touch_updated_at BEFORE UPDATE ON osirus.memory_summaries FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER organizations_touch_updated_at BEFORE UPDATE ON osirus.organizations FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER run_stages_touch_updated_at BEFORE UPDATE ON osirus.run_stages FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER runs_touch_updated_at BEFORE UPDATE ON osirus.runs FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER sessions_touch_updated_at BEFORE UPDATE ON osirus.sessions FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER skill_definitions_touch_updated_at BEFORE UPDATE ON osirus.skill_definitions FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON osirus.users FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
CREATE TRIGGER workspaces_touch_updated_at BEFORE UPDATE ON osirus.workspaces FOR EACH ROW EXECUTE FUNCTION osirus.touch_updated_at();
