// Applies pending db/migrations before a Vercel production build, so a merge
// that adds a migration never ships code ahead of its schema. Runs only on
// Vercel production with DATABASE_URL (set by the Neon integration);
// everywhere else -- previews, CI, local builds -- it does nothing. A failed
// migration fails the build, and the previous deployment stays live.

import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production" || !process.env.DATABASE_URL) {
  console.log("Migrations: skipped (not a Vercel production build).");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["scripts/apply-migrations.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
