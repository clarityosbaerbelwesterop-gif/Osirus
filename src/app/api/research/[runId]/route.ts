import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { queryAs } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ runId: z.string().uuid() });

/** Documents retrieved, claims made and the evidence linking them, for one run. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  const runId = parsed.data.runId;
  const userId = session.user.id;

  const [documents, claims] = await Promise.all([
    queryAs<Record<string, unknown>>(
      userId,
      `select id, url, title, publisher, published_at, retrieved_at, authority,
              provider, left(content, 280) as excerpt
         from osirus.research_documents
        where run_id = $1
        order by retrieved_at
        limit 100`,
      [runId],
    ),
    queryAs<Record<string, unknown>>(
      userId,
      `select c.id, c.statement, c.status, c.confidence,
              coalesce(jsonb_agg(jsonb_build_object(
                'documentId', l.document_id,
                'relation', l.relation,
                'excerpt', left(l.excerpt, 400)
              )) filter (where l.id is not null), '[]'::jsonb) as evidence
         from osirus.research_claims c
         left join osirus.evidence_links l on l.claim_id = c.id
        where c.run_id = $1
        group by c.id
        order by c.created_at
        limit 100`,
      [runId],
    ),
  ]);
  return Response.json({ documents, claims });
}
