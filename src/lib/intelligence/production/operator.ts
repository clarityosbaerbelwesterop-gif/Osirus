import "server-only";
import { queryAs } from "../../db/client";
import { env } from "../../env";

// Platform operators and the server-side tick trigger.
//
// Operators are listed in osirus_intel.operators and maintained in SQL only;
// no route can make someone an operator. The trigger calls this deployment's
// own scheduler tick with the scheduler secret, from the server: the secret
// never reaches a browser, a log or a response. It only fires on the
// production deployment, whose address Vercel supplies; a preview never
// chains or calls anything.

export async function isOperator(userId: string) {
  try {
    const [row] = await queryAs<{ ok: boolean }>(
      userId,
      "select osirus_intel.is_operator() as ok",
    );
    return row?.ok === true;
  } catch {
    // Not migrated yet, or the database is unreachable: nobody is.
    return false;
  }
}

export function productionTickUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !host) return null;
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}/api/scheduler/tick`;
}

/**
 * Ask the scheduler for another tick. Returns once the request is accepted
 * or ten seconds pass; the tick itself runs on in its own invocation.
 */
export async function triggerTick(chain: number) {
  const url = productionTickUrl();
  const secret = env.OSIRUS_SCHEDULER_SECRET;
  if (!url || !secret) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "x-osirus-scheduler-secret": secret,
        "x-osirus-chain": String(chain),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    // A timeout here is expected: the tick keeps running after we let go.
  }
  return true;
}
