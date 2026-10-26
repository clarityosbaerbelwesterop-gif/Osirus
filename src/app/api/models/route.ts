import { apiIdentity, json } from "@/lib/product/api";
import { listNvidiaTopModels } from "@/lib/models/key-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const list = await listNvidiaTopModels();
  return json(list);
}
