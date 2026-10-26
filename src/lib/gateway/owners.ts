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
    const rows = await querySystem<{ email: string | null }>(
      "select email from osirus.users where id = $1::uuid",
      [userId],
    );
    owner = emails.includes((rows[0]?.email ?? "").trim().toLowerCase());
  } catch {
    owner = false;
  }
  known.set(userId, { at: now, owner });
  return owner;
}
