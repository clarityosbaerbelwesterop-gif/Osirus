-- Make row-level security actually enforceable at runtime.
--
-- Migration 004 enables ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY on every
-- table and defines the tenant policies. None of it takes effect, because the
-- application connects with the Neon-managed owner role and that role carries
-- the BYPASSRLS attribute. BYPASSRLS skips policy evaluation entirely and is not
-- overridden by FORCE ROW LEVEL SECURITY, so a verified cross-tenant probe run
-- as the owner could read and delete another tenant's rows.
--
-- Neon does not permit clearing BYPASSRLS from the owner role. Instead the
-- application assumes a dedicated role that does not have it, for the duration
-- of each transaction (see queryAs/querySystem in src/lib/db/client.ts). System
-- work keeps its cross-tenant reach through osirus.is_system(), evaluated by the
-- policies themselves rather than by bypassing them.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'osirus_app') THEN
    CREATE ROLE osirus_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- The connecting owner must be a member of the role in order to assume it.
DO $$
BEGIN
  EXECUTE format('GRANT osirus_app TO %I', current_user);
END
$$;

GRANT USAGE ON SCHEMA osirus TO osirus_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA osirus
  TO osirus_app;

-- Tables added by later migrations must be reachable without another grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA osirus
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO osirus_app;
