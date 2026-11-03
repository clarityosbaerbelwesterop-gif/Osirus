-- GDPR Art. 17: a person deletes their own account.
--
-- The app role cannot touch neon_auth (the sign-in records live there). This
-- function, owned by the migration role, deletes exactly one auth user: the
-- caller's own, as named by app.current_user_id. Deleting it cascades to the
-- person's sign-in sessions and accounts and to osirus.users with everything
-- that hangs off it. The caller deletes their personal organization first
-- (organizations.created_by restricts), which removes all workspace content.
--
-- Kept on purpose (Art. 17(3)(b),(e)): a § 312k cancellation declaration
-- (user_id is set null, the declaration stays as proof) and Stripe's own
-- invoices (held by Stripe under § 147 AO).

CREATE OR REPLACE FUNCTION osirus.delete_own_auth_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller uuid := osirus.current_user_id();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'no current user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM osirus.organizations o WHERE o.created_by = caller
  ) THEN
    RAISE EXCEPTION 'organizations remain';
  END IF;
  DELETE FROM neon_auth."user" WHERE id = caller;
END;
$$;

REVOKE ALL ON FUNCTION osirus.delete_own_auth_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION osirus.delete_own_auth_user() TO osirus_app;
