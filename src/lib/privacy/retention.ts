import "server-only";
import { querySystem } from "../db/client";

// Storage limitation (Art. 5(1)(e) GDPR): what Osirus keeps for its own
// purposes is deleted once the purpose is gone, as the privacy policy
// (section 20) says. Run by the scheduler tick; each rule is one bounded
// statement and a failure of one never stops the others.
//
// Audit 2026-11-17: nothing was ever deleted. request_rate_limits held
// every per-minute counter since 2026-09-23 (user ids, hashed IP and e-mail
// addresses), and the cancellation table could not delete a row at all.

/** A per-minute counter is useless after its minute; a day covers clock skew. */
export const RATE_LIMIT_KEEP_HOURS = 24;
/** The IP hash on a cancellation only guards the days around it. */
export const CANCELLATION_HASH_KEEP_DAYS = 30;
/**
 * A cancellation is proof until the regular limitation period ends: three
 * years from the end of the year the contract ends (§§ 195, 199 BGB).
 */
export const CANCELLATION_KEEP_YEARS = 3;

const BATCH = 5_000;

/** A bot computer's saved working folder, after its last use. */
export const BOT_COMPUTER_FILES_KEEP_DAYS = 7;

export type RetentionResult = Record<string, number>;

export const RETENTION_RULES: Array<{ name: string; sql: string }> = [
  {
    name: "rateLimitCounters",
    sql: `delete from osirus.request_rate_limits
           where ctid in (
             select ctid from osirus.request_rate_limits
              where window_started_at < now() - make_interval(hours => ${RATE_LIMIT_KEEP_HOURS})
              limit ${BATCH})`,
  },
  {
    name: "cancellationNetworkHashes",
    sql: `update osirus.contract_cancellations
             set network_hash = null
           where network_hash is not null
             and received_at < now() - make_interval(days => ${CANCELLATION_HASH_KEEP_DAYS})`,
  },
  {
    name: "botComputerFiles",
    sql: `delete from osirus.bot_computer_files
           where updated_at < now() - make_interval(days => ${BOT_COMPUTER_FILES_KEEP_DAYS})`,
  },
  {
    name: "cancellations",
    // End of the year the contract ended (or, without an end, the year the
    // declaration came in) plus three years: the start of year + 4.
    sql: `delete from osirus.contract_cancellations
           where date_trunc('year', coalesce(effective_at, received_at))
                 + make_interval(years => ${CANCELLATION_KEEP_YEARS + 1}) <= now()`,
  },
];

export async function applyRetention(): Promise<RetentionResult> {
  const result: RetentionResult = {};
  for (const rule of RETENTION_RULES) {
    try {
      const rows = await querySystem<Record<string, unknown>>(
        `with done as (${rule.sql} returning 1) select count(*)::int as n from done`,
      );
      result[rule.name] = Number(rows[0]?.n ?? 0);
    } catch (error) {
      console.error(
        "retention rule failed",
        rule.name,
        error instanceof Error ? error.name : "unknown",
      );
      result[rule.name] = -1;
    }
  }
  return result;
}
