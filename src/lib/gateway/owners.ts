import "server-only";
import { querySystem } from "@/lib/db/client";
import { env } from "@/lib/env";

// Owner sign-ins (OSIRUS_OWNER_EMAILS) by user id, for code that only has
// the id: the runtime's quota guard. Answers are cached for ten minutes.
// Without the variable nobody is an owner and nothing is queried.

const TTL_MS = 10 * 60 * 1000;
const known = new Map<string, { at: number; owner: boolean }>();

export function ownerEmailList() {
  return (env.OSIRUS_OWNER_EMAILS ?? process.env.OSIRUS_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isOwnerUser(userId: string, now = Date.now()) {
  const emails = ownerEmailList();
  if (emails.length === 0) return false;
  const cached = known.get(userId);
  if (cached && now - cached.at < TTL_MS) return cached.owner;
  let owner = false;
  try {
    // Only a verified address counts: anyone can register an owner address
    // that is not taken yet, and an owner runs without quota.
    const rows = await querySystem<{
      email: string | null;
      verified: boolean | null;
    }>(
      `select u.email, a."emailVerified" as verified
         from osirus.users u
         left join neon_auth."user" a on a.id = u.id
        where u.id = $1::uuid`,
      [userId],
    );
    owner =
      rows[0]?.verified === true &&
      emails.includes((rows[0]?.email ?? "").trim().toLowerCase());
  } catch {
    owner = false;
  }
  known.set(userId, { at: now, owner });
  return owner;
}
