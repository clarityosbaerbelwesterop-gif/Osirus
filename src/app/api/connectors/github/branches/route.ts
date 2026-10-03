import { z } from "zod";
import { apiIdentity, json } from "@/lib/product/api";
import {
  githubListMessage,
  listGrantedBranches,
} from "@/lib/connectors/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  owner: z.string().trim().min(1).max(39),
  name: z.string().trim().min(1).max(100),
});

export async function GET(request: Request) {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    owner: url.searchParams.get("owner"),
    name: url.searchParams.get("name"),
  });
  if (!parsed.success)
    return json({ ok: false, message: "Choose a repository first." }, 400);
  const listed = await listGrantedBranches(identity, parsed.data);
  if (!listed.ok) {
    return json(
      {
        ok: false,
        error: listed.error,
        message: githubListMessage(listed.error, listed.status),
      },
      listed.error === "not_configured" ? 503 : 409,
    );
  }
  return json({ ok: true, branches: listed.branches });
}
