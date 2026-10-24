import { env, serverKeys } from "@/lib/env";
import { apiIdentity, json } from "@/lib/product/api";
import { listKeyModels } from "@/lib/models/key-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const list = await listKeyModels({
    baseUrl: env.UNOROUTER_BASE_URL,
    keys: serverKeys(),
  });
  return json(list);
}
