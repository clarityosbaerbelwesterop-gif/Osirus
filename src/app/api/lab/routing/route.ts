import { loadProductSession } from "@/lib/product/session";
import { labRoutingSnapshot } from "@/lib/lab/snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await loadProductSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(labRoutingSnapshot());
}
