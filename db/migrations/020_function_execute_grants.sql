-- DB-1 (residual risk, accepted and documented): GUC-based identity is forgeable.
--
-- Tenant and system identity ride on two transaction-local GUCs,
-- app.current_user_id and app.osirus_system, set by queryAs/querySystem in
-- src/lib/db/client.ts. Any principal able to execute arbitrary SQL as a role
-- with osirus_app membership can call set_config on those GUCs itself and
-- impersonate any tenant -- or the system. Postgres offers no secret primitive
-- that a same-role SQL session cannot also read, so there is no in-database
-- mechanism that makes the GUC unforgeable without moving identity enforcement
-- out of the session entirely. This migration does not pretend otherwise.
--
-- The residual risk is instead held down by deployment discipline:
--   * every application statement is parameterised; untrusted input can never
--     become SQL text, so there is no path from request data to set_config;
--   * no endpoint accepts or proxies raw SQL;
--   * osirus_app is NOLOGIN, so only roles explicitly granted membership (the
--     connecting owner) can assume it, and the owner credential is a
--     deployment secret rather than a runtime identity;
--   * cross-tenant reads that bypass app.current_user_id would stand out in
--     statement/audit logs and are a monitoring signal.
-- If a future requirement needs a hard boundary, it has to come from outside
-- the session (separate credentials per trust level, or a proxy that owns the
-- GUCs), not from more SQL in this file.
--
-- DB-4: osirus.* and osirus_intel.* functions no longer rely on PUBLIC EXECUTE.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default. Until
-- now every helper -- tenant-identity readers, SECURITY DEFINER policy
-- helpers, and worker functions such as claim_next_stage -- was executable by
-- any role that can reach the schema, and only schema USAGE kept strangers
-- out. This migration revokes the implicit PUBLIC grant on every function in
-- both schemas and grants EXECUTE to osirus_app explicitly, which is the only
-- application role that runs statements against them: policy helpers are
-- invoked by statements already running as osirus_app (SECURITY DEFINER
-- changes who the body executes as, not who needs EXECUTE), and the workers
-- call in through queryAs/querySystem. The owner role is untouched: it owns
-- the functions and keeps its implicit rights for migrations and maintenance.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('osirus', 'osirus_intel')
      -- Functions, procedures and window functions; aggregates are excluded
      -- because GRANT/REVOKE ON FUNCTION does not cover them (none exist in
      -- these schemas today).
      AND p.prokind IN ('f', 'p', 'w')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON %s %I.%I(%s) FROM PUBLIC',
      CASE WHEN fn.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
    EXECUTE format(
      'GRANT EXECUTE ON %s %I.%I(%s) TO osirus_app',
      CASE WHEN fn.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );
  END LOOP;
END
$$;

-- Functions added by later migrations must not reopen the PUBLIC grant or
-- strand osirus_app without EXECUTE, so the defaults match the loop above.
ALTER DEFAULT PRIVILEGES IN SCHEMA osirus
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA osirus
  GRANT EXECUTE ON FUNCTIONS TO osirus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA osirus_intel
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA osirus_intel
  GRANT EXECUTE ON FUNCTIONS TO osirus_app;
