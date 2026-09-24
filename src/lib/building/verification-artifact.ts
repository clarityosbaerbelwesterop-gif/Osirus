import type { QaReport } from "../coding/browser-qa";
import type { BuildContract } from "./contract";
import { contractCoverage } from "./contract";

// Verification artifacts for product builds.
//
// After browser QA the building arm stores a markdown artifact the run can
// cite: what was checked, what passed, what failed, and which contract probes
// were confirmed. This is evidence for handoffs and pulse L5, not a second QA
// runner.

export type VerificationArtifact = {
  title: string;
  kind: "verification-report";
  content: string;
  evidenceRefs: string[];
};

export function verificationArtifactFromQa(
  contract: BuildContract,
  report: QaReport,
): VerificationArtifact {
  const failed = report.checks.filter((check) => !check.passed);
  const coverage =
    report.mode === "browser" ? contractCoverage(contract, report) : null;
  const screenshots = report.viewports
    .filter((viewport) => viewport.screenshotBytes > 0)
    .map((viewport) => viewport.name);
  const lines = [
    `# Verification report: ${contract.product}`,
    "",
    `- Mode: **${report.mode}**`,
    `- URL: ${report.url || "(none)"}`,
    `- Status: ${report.status ?? "unknown"}`,
    `- Title: ${report.title ?? "(none)"}`,
    `- Checks: ${report.checks.length - failed.length}/${report.checks.length} passed`,
    "",
  ];
  if (screenshots.length) {
    lines.push(
      "## Screenshots",
      "",
      screenshots.map((name) => `- ${name} (${report.viewports.find((v) => v.name === name)?.screenshotBytes ?? 0} bytes)`).join("\n"),
      "",
    );
  }
  if (failed.length) {
    lines.push(
      "## Failed checks",
      "",
      ...failed.map((check) => `- **${check.id}**: ${check.detail}`),
      "",
    );
  }
  if (report.consoleErrors.length) {
    lines.push(
      "## Console errors",
      "",
      ...report.consoleErrors.slice(0, 10).map((error) => `- ${error}`),
      "",
    );
  }
  if (coverage) {
    lines.push(
      "## Contract coverage",
      "",
      coverage.missing.length
        ? `Missing probes:\n${coverage.missing.map((item) => `- ${item}`).join("\n")}`
        : `All ${coverage.covered.length} acceptance probe(s) found.`,
      "",
    );
  }
  if (report.reason) {
    lines.push("## Notes", "", report.reason, "");
  }
  const evidenceRefs = [
    `qa:${report.mode}:${report.url}`,
    ...screenshots.map((name) => `screenshot:${name}`),
    ...report.checks
      .filter((check) => check.passed)
      .slice(0, 8)
      .map((check) => `check:${check.id}`),
  ];
  return {
    title: `QA verification: ${contract.product}`,
    kind: "verification-report",
    content: lines.join("\n"),
    evidenceRefs: evidenceRefs.slice(0, 16),
  };
}
