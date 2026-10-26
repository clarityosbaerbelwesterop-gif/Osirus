import { json } from "@/lib/product/api";
import { modelAccessFor, modelAllowed } from "@/lib/gateway/access";
import {
  listGatewayModels,
  publicModel,
  publicModelId,
  uniqueByName,
} from "@/lib/gateway/models";
import { candidatesFor } from "@/lib/gateway/routing";
import { loadProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The models Code offers the signed-in person, best first, and the default
 * (the strongest coding model). Names and classes only: no service names,
 * no internal references.
 */
export async function GET() {
  const session = await loadProductSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  const [access, listing] = await Promise.all([
    modelAccessFor({
      userId: session.identity.userId,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    }),
    listGatewayModels(),
  ]);
  const allowed = listing.models.filter((model) => modelAllowed(model, access));
  const best = candidatesFor(allowed, "top", { coding: true, limit: 1 })[0];
  return json({
    models: uniqueByName(allowed).map(publicModel),
    defaultId: best ? publicModelId(best.ref) : null,
    freeOnly: access.freeOnly,
  });
}
