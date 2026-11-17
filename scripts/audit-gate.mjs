#!/usr/bin/env node
// Supply-chain gate for CI: fails on any high or critical advisory in the
// production dependency tree that is not accepted, with a reason and an
// unexpired date, in security/audit-allowlist.json.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(
    "audit-gate: npm audit gave no JSON",
    audit.stderr.slice(0, 500),
  );
  process.exit(1);
}

const allowlist = JSON.parse(
  readFileSync(new URL("../security/audit-allowlist.json", import.meta.url)),
).accepted;
const accepted = new Map(allowlist.map((entry) => [entry.id, entry]));

const findings = new Map();
for (const [name, vulnerability] of Object.entries(
  report.vulnerabilities ?? {},
)) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
    const id = String(via.url ?? "")
      .split("/")
      .pop();
    findings.set(id, {
      id,
      package: name,
      severity: via.severity,
      title: via.title,
    });
  }
}

const failures = [];
for (const finding of findings.values()) {
  const entry = accepted.get(finding.id);
  if (!entry)
    failures.push(
      `${finding.severity} ${finding.package} ${finding.id}: ${finding.title}`,
    );
  else if (entry.expires < today)
    failures.push(
      `${finding.id} (${finding.package}): acceptance expired on ${entry.expires}`,
    );
}
const unused = allowlist.filter((entry) => !findings.has(entry.id));

console.log(
  `audit-gate: ${findings.size} high/critical production advisories, ${findings.size - failures.length} accepted`,
);
for (const entry of unused)
  console.log(
    `audit-gate: ${entry.id} is fixed now; remove it from the allowlist`,
  );
if (failures.length) {
  console.error("audit-gate: blocking advisories:\n  " + failures.join("\n  "));
  process.exit(1);
}
