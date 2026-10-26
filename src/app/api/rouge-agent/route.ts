import { json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// This endpoint used to answer with canned "verified" steps without calling
// any model. The Rouge Agent now runs on the agent runtime:
// POST /api/runtime with { surface: "agent", modelId: "<provider>:<model>" }.
// The self-cloning library in src/lib/rouge-agent stays for a later real
// executor; it is not exposed until its executor calls models.
export async function POST() {
  return json(
    {
      error: "moved",
      message:
        'Der Rouge Agent läuft über /api/runtime (surface "agent"). Dieser Endpunkt lieferte keine echten Modellergebnisse und ist abgeschaltet.',
    },
    410,
  );
}
