export const PLANS: Array<{ plan: string; label: string; eur: number }>;
export const REQUIRED_EVENTS: string[];
export function lookupKeyFor(plan: string): string;
export function webhookUrl(publicUrl: string): string;

type Endpoint = {
  id?: string;
  url: string;
  enabled_events?: string[];
  status?: string;
};

export function pickEndpoint<T extends Endpoint>(
  endpoints: T[] | null | undefined,
  url: string,
): T | null;
export function endpointChanges(
  endpoint: Endpoint,
  url: string,
): {
  changes: { url?: string; enabled_events?: string[]; disabled?: boolean };
  missing: string[];
} | null;
export function stripeSignature(
  payload: string,
  secret: string,
  timestamp: number,
): string;
export function keyMode(key: string | undefined): "live" | "test" | "unknown";
