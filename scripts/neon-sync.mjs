// Neon side of the runtime sync. Neon takes no API keys: the Vercel-Neon
// integration hands DATABASE_URL to Vercel. This step reads the Neon project
// (region, default branch, database), checks that the schema the code needs is
// there, and checks that Vercel runs its functions next to the database.
//
// Without DATABASE_URL in GitHub, the connection string comes from the Neon
// API (NEON_API_KEY) and is handed to the migration step as NEON_DATABASE_URL,
// masked. Nothing here prints a connection string or a key.

import { appendFileSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import {
  missingTables,
  neonRegionFromUrl,
  REQUIRED_TABLES,
  resolveNeonProject,
  vercelRegionForNeon,
} from "./lib/neon.mjs";
import { optionalSecret } from "./lib/vercel-env.mjs";

const summary = [];
function report(line) {
  console.log(line);
  summary.push(`- ${line}`);
}

const neonApiKey = optionalSecret(process.env.NEON_API_KEY);
const projectId =
  optionalSecret(process.env.NEON_PROJECT_ID) ?? "super-voice-69875601";
let databaseUrl = optionalSecret(process.env.DATABASE_URL);
let regionId =
  neonRegionFromUrl(databaseUrl) ??
  neonRegionFromUrl(process.env.NEON_AUTH_URL);

if (neonApiKey) {
  const project = await resolveNeonProject({ apiKey: neonApiKey, projectId });
  regionId = project.regionId ?? regionId;
  report(
    `Neon project ${project.projectName}: region ${regionId}, branch ${project.branchName}, database ${project.databaseName}`,
  );
  if (!databaseUrl) {
    databaseUrl = project.uri;
    if (process.env.GITHUB_ENV) {
      console.log(`::add-mask::${project.uri}`);
      const password = new URL(project.uri).password;
      if (password) console.log(`::add-mask::${password}`);
      appendFileSync(
        process.env.GITHUB_ENV,
        `NEON_DATABASE_URL=${project.uri}\n`,
      );
    }
  }
} else {
  report("NEON_API_KEY not set: Neon project details skipped.");
}

// Region: every request makes several database round trips, so functions in
// another continent than the database cost seconds per page.
const wanted = vercelRegionForNeon(regionId);
const configured =
  JSON.parse(readFileSync("vercel.json", "utf8")).regions ?? [];
if (!wanted) {
  report(
    `Region: Neon region ${regionId ?? "unknown"} has no mapped Vercel region.`,
  );
} else if (configured.length === 1 && configured[0] === wanted) {
  report(
    `Region: Vercel functions (${wanted}) run next to Neon (${regionId}).`,
  );
} else {
  console.log(
    `::warning::vercel.json regions ${JSON.stringify(configured)} do not match Neon ${regionId}; set "regions": ["${wanted}"].`,
  );
  summary.push(
    `- Region mismatch: vercel.json should pin ${wanted} for Neon ${regionId}.`,
  );
}

// Schema: the tables the current code reads. Missing ones mean pending
// migrations; the migration step applies them when the dispatch asks for it.
if (databaseUrl) {
  const sql = neon(databaseUrl);
  const rows = await sql.query(
    "select name from unnest($1::text[]) as name where to_regclass(name) is not null",
    [REQUIRED_TABLES],
  );
  const missing = missingTables(rows.map((row) => row.name));
  report(
    missing.length
      ? `Schema: ${missing.length} required table(s) missing: ${missing.join(", ")}. Run with migrate=true.`
      : `Schema: all ${REQUIRED_TABLES.length} required tables present.`,
  );
} else {
  report(
    "Schema check skipped: neither DATABASE_URL nor NEON_API_KEY is configured.",
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Neon\n${summary.join("\n")}\n`,
  );
}
