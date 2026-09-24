import { reportFrom, type BrowserSession } from "../computer/browser";
import type { QaCheck, QaReport } from "../coding/browser-qa";

// Observe → act → verify for computer and browser tasks.
//
// The production agent loop already runs observe/decide/act cycles. This module
// makes the browser slice explicit: capture what the page shows, perform typed
// actions, grade the result against probes, and return structured evidence the
// verifier and pulse suite can consume without re-parsing prose.

export type ObserveSnapshot = {
  url: string;
  status: number | null;
  title: string | null;
  visibleText: string;
  consoleErrors: string[];
  failedRequests: string[];
  selectors: Array<{ selector: string; count: number }>;
  accessibility: BrowserSession["a11y"];
  layout: Array<{ viewport: string; horizontalOverflow: boolean }>;
};

export type ActRecord = {
  type: string;
  selector: string | null;
  ok: boolean;
  detail: string;
};

export type VerifyOutcome = {
  passed: boolean;
  mode: QaReport["mode"];
  checks: QaCheck[];
  failedCheckIds: string[];
  summary: string;
};

export type ObserveActVerifyResult = {
  observe: ObserveSnapshot;
  acts: ActRecord[];
  verify: VerifyOutcome;
  evidenceRefs: string[];
};

function snapshotFromSession(
  url: string,
  session: BrowserSession,
): ObserveSnapshot {
  return {
    url,
    status: session.status,
    title: session.title,
    visibleText: (session.visibleText ?? "").slice(0, 2_000),
    consoleErrors: session.consoleErrors.slice(0, 10),
    failedRequests: session.failedRequests.slice(0, 10),
    selectors: session.selectors,
    accessibility: session.a11y,
    layout: session.viewports.map((viewport) => ({
      viewport: viewport.name,
      horizontalOverflow: viewport.horizontalOverflow,
    })),
  };
}

function actsFromSession(session: BrowserSession): ActRecord[] {
  return session.actions.map((action) => ({
    type: action.type,
    selector: action.selector,
    ok: action.ok,
    detail: action.detail,
  }));
}

function verifyFromReport(report: QaReport): VerifyOutcome {
  const failed = report.checks.filter((check) => !check.passed);
  const failedCheckIds = failed.map((check) => check.id);
  const passed =
    report.mode !== "unavailable" &&
    failedCheckIds.length === 0 &&
    report.consoleErrors.length === 0;
  const summary = passed
    ? `${report.mode} QA: ${report.checks.length} check(s) passed.`
    : [
        failed.length
          ? `Failed checks: ${failed.map((check) => check.id).join(", ")}`
          : "",
        report.consoleErrors.length
          ? `Console errors: ${report.consoleErrors.slice(0, 3).join("; ")}`
          : "",
        report.reason ? report.reason : "",
      ]
        .filter(Boolean)
        .join(" ");
  return { passed, mode: report.mode, checks: report.checks, failedCheckIds, summary };
}

/** Evidence refs for a browser session, suitable for TaskState and artifacts. */
export function evidenceRefsForBrowser(
  url: string,
  session: BrowserSession,
): string[] {
  const refs = [`browser:${url}`];
  if (session.title) refs.push(`title:${session.title.slice(0, 80)}`);
  for (const viewport of session.viewports) {
    if (viewport.screenshotBytes > 0) {
      refs.push(`screenshot:${viewport.name}`);
    }
  }
  for (const entry of session.texts.filter((item) => item.found)) {
    refs.push(`text:${entry.text.slice(0, 60)}`);
  }
  for (const action of session.actions.filter((item) => item.ok)) {
    if (action.selector) refs.push(`action:${action.type}:${action.selector}`);
  }
  return refs.slice(0, 12);
}

/**
 * Grade a browser session against explicit probes.
 *
 * When expectations are omitted the report still records accessibility,
 * overflow and console errors from what was observed.
 */
export function verifyBrowserSession(
  url: string,
  session: BrowserSession,
  expectations: { selectors?: string[]; texts?: string[] } = {},
): VerifyOutcome {
  const report = reportFrom(url, session, expectations);
  return verifyFromReport(report);
}

/**
 * One explicit observe → act → verify cycle over an already-captured session.
 *
 * Arms and pulse fixtures call this after SandboxBrowser.session() or an
 * offline fixture session so grading is shared between production and tests.
 */
export function observeActVerifyFromSession(
  url: string,
  session: BrowserSession,
  expectations: { selectors?: string[]; texts?: string[] } = {},
): ObserveActVerifyResult {
  const verify = verifyBrowserSession(url, session, expectations);
  return {
    observe: snapshotFromSession(url, session),
    acts: actsFromSession(session),
    verify,
    evidenceRefs: evidenceRefsForBrowser(url, session),
  };
}

/** Summarise an OAV result for loop observations without prose invention. */
export function formatObserveActVerify(result: ObserveActVerifyResult): string {
  const lines = [
    `URL: ${result.observe.url}`,
    `Status: ${result.observe.status ?? "unknown"}`,
    `Title: ${result.observe.title ?? "(none)"}`,
    `Visible text (excerpt): ${result.observe.visibleText.slice(0, 400)}`,
  ];
  if (result.acts.length) {
    lines.push(
      `Actions: ${result.acts
        .map(
          (action) =>
            `${action.type}${action.selector ? ` ${action.selector}` : ""} -> ${action.ok ? "ok" : "failed"} (${action.detail})`,
        )
        .join("; ")}`,
    );
  }
  lines.push(`Verify (${result.verify.mode}): ${result.verify.summary}`);
  if (result.evidenceRefs.length) {
    lines.push(`Evidence refs: ${result.evidenceRefs.join(", ")}`);
  }
  return lines.join("\n");
}
