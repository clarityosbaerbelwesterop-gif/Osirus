import { neon } from "@neondatabase/serverless";
import { env } from "../env";
export function db() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(env.DATABASE_URL);
}
export async function withIdentity<T>(
  userId: string,
  fn: (sql: ReturnType<typeof neon>) => Promise<T>,
) {
  const sql = db();
  await sql.query("select set_config('app.current_user_id',$1,true)", [userId]);
  return fn(sql);
}
