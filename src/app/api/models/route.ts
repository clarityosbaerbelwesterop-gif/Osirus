import { json } from "@/lib/product/api";
import { modelAccessFor, modelAllowed } from "@/lib/gateway/access";
import {
  listGatewayModels,
  pickDefaultModel,
  publicModel,
} from "@/lib/gateway/models";
import { loadProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Every model the signed-in person may call, best first, and the default. */
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
  return json({
    models: allowed.map(publicModel),
    defaultRef: pickDefaultModel(allowed)?.ref ?? null,
    providers: listing.providers,
    freeOnly: access.freeOnly,
    unlimited: access.unlimited,
  });
}
