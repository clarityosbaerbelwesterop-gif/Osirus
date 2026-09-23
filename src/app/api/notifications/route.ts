import { z } from "zod";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/product/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ notifications: await listNotifications(identity) });
}

const schema = z.object({
  read: z.union([z.literal("all"), z.array(z.string().uuid()).max(200)]),
});

/** Mark notifications read: a list of ids, or "all". */
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "notifications.read",
    limit: 60,
    maxBytes: 16 * 1024,
  });
  if (!guard.ok) return guard.response;
  await markNotificationsRead(guard.identity, guard.body.read);
  return json({ ok: true });
}
