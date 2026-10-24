import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { recommendWork } from "@/lib/work/recommend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
});

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "work.recommend",
    limit: 30,
    maxBytes: 24_000,
  });
  if (!guard.ok) return guard.response;
  return json(recommendWork(guard.body.prompt));
}
