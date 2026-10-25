import { isQuotaExhausted } from "@/lib/quota/tracker";
import { loadProductSession } from "@/lib/product/session";

/**
 * Check if free tier is enabled via environment variable.
 */
export function isFreeTierEnabled(): boolean {
  return process.env.OSIRUS_FREE_TIER_ENABLED !== "false";
}

/**
 * Get the label for the account creation button.
 */
export function startAccountLabel(): string {
  return isFreeTierEnabled() ? "Kostenlos starten" : "Konto erstellen";
}

/**
 * Check if the current user's free tier quota is exhausted.
 * Returns null if free tier is disabled or user is not authenticated.
 */
export async function isFreeQuotaExhausted(): Promise<{
  exhausted: boolean;
  windowType: "five_hour" | "weekly" | null;
} | null> {
  if (!isFreeTierEnabled()) return null;

  const session = await loadProductSession();
  if (!session) return null;

  return isQuotaExhausted(session.identity.userId, session.identity.workspaceId);
}

/**
 * Get the free tier quota usage for the current user.
 * Returns null if free tier is disabled or user is not authenticated.
 */
export async function getFreeQuotaUsage(): Promise<{
  fiveHour: { used: number; limit: number; remaining: number; resetsAt: string };
  weekly: { used: number; limit: number; remaining: number; resetsAt: string };
} | null> {
  if (!isFreeTierEnabled()) return null;

  const session = await loadProductSession();
  if (!session) return null;

  const { getQuotaUsage } = await import("@/lib/quota/tracker");
  return getQuotaUsage(session.identity.userId, session.identity.workspaceId);
}