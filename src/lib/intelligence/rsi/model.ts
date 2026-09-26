import { env } from "../../env";
import { FREE_MODELS } from "../../models/free";

/**
 * The free model RSI spends its calls on. The runtime sync writes
 * OSIRUS_FREE_MODEL_PRIMARY only from a model that answered a chat probe
 * (M49); the hard-coded ID the cycle used before stopped answering on
 * 2026-09-25 ("all providers busy"). Never a paid model.
 */
export function rsiModel() {
  const primary = env.OSIRUS_FREE_MODEL_PRIMARY?.trim();
  return primary && /:free$/i.test(primary) ? primary : FREE_MODELS[0];
}
