import { apiIdentity, json } from "@/lib/product/api";
import { exportAccountData } from "@/lib/privacy/account";
import {
  enforceRateLimit,
  RateLimitError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Art. 15/20 DSGVO: the person's own data as one JSON file. */
export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "account.export",
      limit: 5,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return json(
        { error: "rate_limited", message: "Bitte in einer Minute erneut versuchen." },
        429,
      );
  }
  const payload = await exportAccountData(identity);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="osirus-daten-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
