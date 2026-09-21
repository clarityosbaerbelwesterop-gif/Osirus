import { neon } from "@neondatabase/serverless";
import { env } from "../env";

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
    sql.query("select set_config('app.current_user_id', $1, true)", [userId]),
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
    sql.query("select set_config('app.osirus_system', 'true', true)"),
    sql.query(text, params),
  ]);
  return results[1] as unknown as T[];
}
