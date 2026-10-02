import "server-only";
import { join } from "node:path";
import { routingSnapshot } from "../../../ai-lab/tracks/status";

/** Live routing snapshot for the settings surface. Never includes API keys. */
export function labRoutingSnapshot(env: NodeJS.ProcessEnv = process.env) {
  return routingSnapshot({
    definitionsDir: join(process.cwd(), "ai-lab/tracks/definitions"),
    checkpointDir: join(process.cwd(), "ai-lab/var/native"),
    env,
  });
}
