import { neon } from "@neondatabase/serverless";
import { env } from "../env";

// Neon's managed owner role carries BYPASSRLS, which skips row-level security
// outright -- FORCE ROW LEVEL SECURITY does not override it, and Neon does not
// allow clearing the attribute. Every statement therefore runs after assuming a
// role that lacks it, so the policies in db/migrations/004_security_rls.sql are
// the thing that actually enforces tenant isolation. The role is created by
// db/migrations/007_app_role.sql; if it is missing these calls fail loudly
// rather than quietly falling back to a connection that bypasses every policy.
const APP_ROLE = "osirus_app";

export function db() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(env.DATABASE_URL);
}

export async function queryAs<T>(
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = db();
  const results = await sql.transaction([
    sql.query(
      "select set_config('app.current_user_id', $1, true), set_config('role', $2, true)",
      [userId, APP_ROLE],
    ),
    sql.query(text, params),
  ]);
  return results[1] as unknown as T[];
}

export async function querySystem<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = db();
  const results = await sql.transaction([
    // System work still assumes the non-bypassing role: its cross-tenant reach
    // comes from osirus.is_system() inside the policies, not from skipping them.
    sql.query(
      "select set_config('app.osirus_system', 'true', true), set_config('role', $1, true)",
      [APP_ROLE],
    ),
    sql.query(text, params),
  ]);
  return results[1] as unknown as T[];
}
