import type { QaReport } from "../coding/browser-qa";
import type { BrowserSession } from "../computer/browser";
import {
  applyHypothesisEvidence,
  type HypothesisEvidence,
  type TaskEvidence,
  type TaskState,
} from "./task-state";
import {
  evidenceRefsForBrowser,
  type ObserveActVerifyResult,
} from "./observe-act-verify";

// Multimodal grounding: vision/DOM/state evidence attached to hypotheses.
//
// Tool results and QA reports carry structured refs — URLs, screenshot
// viewports, visible text, attachment chunk locators — that move only the
// hypotheses they bear on. This reuses the existing TaskState evidence
// pipeline; it does not add a second cognitive store.

export type GroundingSource =
  "dom" | "screenshot" | "browser-action" | "qa-report" | "attachment";

export type GroundingBundle = {
  refs: string[];
  summary: string;
  source: GroundingSource;
  hypothesisIds?: string[];
  relation?: HypothesisEvidence["relation"];
};

function pushEvidence(
  state: TaskState,
  bundle: GroundingBundle,
  stepIndex: number,
) {
  for (const ref of bundle.refs) {
    if (!state.evidenceRefs.includes(ref)) state.evidenceRefs.push(ref);
    const item: TaskEvidence = {
      id: `g${state.evidence.length + 1}`,
      ref,
      summary: bundle.summary.slice(0, 240),
      source: bundle.source === "attachment" ? "artifact" : "tool",
      stepIndex,
      hypothesisIds: bundle.hypothesisIds ?? [],
    };
    state.evidence.push(item);
    if (bundle.relation === "contradicts" || bundle.relation === "falsifies") {
      state.counterEvidence.push(item);
    }
  }
  state.evidence = state.evidence.slice(-40);
  state.counterEvidence = state.counterEvidence.slice(-40);
  state.evidenceRefs = state.evidenceRefs.slice(-40);
}

/** Ground hypotheses from a browser session (DOM, actions, screenshots). */
export function groundingFromBrowserSession(
  session: BrowserSession,
  url: string,
  input?: {
    hypothesisIds?: string[];
    relation?: HypothesisEvidence["relation"];
  },
): GroundingBundle {
  const refs = evidenceRefsForBrowser(url, session);
  const foundTexts = session.texts.filter((item) => item.found).length;
  const failedActions = session.actions.filter((action) => !action.ok).length;
  const relation =
    input?.relation ??
    (failedActions > 0 || session.error
      ? "contradicts"
      : foundTexts > 0 || session.actions.some((action) => action.ok)
        ? "supports"
        : undefined);
  const summary = [
    `Browser session at ${url}`,
    session.title ? `title=${session.title}` : "",
    foundTexts ? `${foundTexts} expected text(s) found` : "",
    failedActions ? `${failedActions} action(s) failed` : "",
    session.consoleErrors.length
      ? `${session.consoleErrors.length} console error(s)`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    refs,
    summary,
    source: session.viewports.some((viewport) => viewport.screenshotBytes > 0)
      ? "screenshot"
      : "dom",
    hypothesisIds: input?.hypothesisIds,
    relation,
  };
}

/** Ground hypotheses from a building QA report. */
export function groundingFromQaReport(
  report: QaReport,
  input?: { hypothesisIds?: string[] },
): GroundingBundle {
  const failed = report.checks.filter((check) => !check.passed);
  const refs = [
    `qa:${report.mode}:${report.url}`,
    ...report.viewports
      .filter((viewport) => viewport.screenshotBytes > 0)
      .map((viewport) => `screenshot:${viewport.name}`),
    ...report.checks
      .filter((check) => check.passed)
      .slice(0, 6)
      .map((check) => `check:${check.id}`),
  ];
  const relation =
    report.mode === "unavailable" || failed.length > 0
      ? "contradicts"
      : report.mode === "browser"
        ? "supports"
        : undefined;
  const summary =
    report.mode === "unavailable"
      ? `QA unavailable${report.reason ? `: ${report.reason}` : ""}`
      : `${report.mode} QA at ${report.url}: ${report.checks.length - failed.length}/${report.checks.length} checks passed`;
  return {
    refs: refs.slice(0, 12),
    summary,
    source: "qa-report",
    hypothesisIds: input?.hypothesisIds,
    relation,
  };
}

/** Ground hypotheses from a parsed attachment chunk locator. */
export function groundingFromAttachment(
  attachmentId: string,
  locator: string,
  excerpt: string,
  input?: { hypothesisIds?: string[] },
): GroundingBundle {
  const ref = `attachment:${attachmentId}:${locator}`;
  return {
    refs: [ref],
    summary: excerpt.slice(0, 240),
    source: "attachment",
    hypothesisIds: input?.hypothesisIds,
    relation: "supports",
  };
}

/** Apply one grounding bundle to task state and named hypotheses. */
export function applyGrounding(
  state: TaskState,
  bundle: GroundingBundle,
  stepIndex = -1,
) {
  pushEvidence(state, bundle, stepIndex);
  if (bundle.hypothesisIds?.length && bundle.relation) {
    applyHypothesisEvidence(state.hypotheses, {
      hypothesisIds: bundle.hypothesisIds,
      relation: bundle.relation,
      verdictStatus: bundle.relation === "supports" ? "verified" : "failed",
      summary: bundle.summary,
      refs: bundle.refs,
    });
  }
}

/** Ground from a computer.inspect tool payload. */
export function groundComputerInspectResult(
  state: TaskState,
  data: Record<string, unknown>,
  hypothesisIds?: string[],
) {
  const url =
    typeof data.url === "string"
      ? data.url
      : `http://127.0.0.1:${data.port ?? 4173}${data.path ?? "/"}`;
  const session: BrowserSession = {
    status: typeof data.status === "number" ? data.status : null,
    title: typeof data.title === "string" ? data.title : null,
    html: "",
    visibleText: typeof data.visibleText === "string" ? data.visibleText : "",
    consoleErrors: Array.isArray(data.consoleErrors)
      ? data.consoleErrors.map(String)
      : [],
    failedRequests: Array.isArray(data.failedRequests)
      ? data.failedRequests.map(String)
      : [],
    actions: Array.isArray(data.actions)
      ? data.actions.map((action) => {
          const row = action as Record<string, unknown>;
          return {
            type: String(row.type ?? "unknown"),
            selector: typeof row.selector === "string" ? row.selector : null,
            ok: row.ok === true,
            detail: String(row.detail ?? ""),
          };
        })
      : [],
    viewports: Array.isArray(data.layout)
      ? data.layout.map((entry) => {
          const row = entry as Record<string, unknown>;
          return {
            name: String(row.viewport ?? "desktop"),
            horizontalOverflow: row.horizontalOverflow === true,
            screenshotBytes: 0,
          };
        })
      : [],
    a11y:
      data.accessibility && typeof data.accessibility === "object"
        ? (data.accessibility as BrowserSession["a11y"])
        : {},
    selectors: [],
    texts: Array.isArray(data.expectedText)
      ? data.expectedText.map((entry) => {
          const row = entry as Record<string, unknown>;
          return {
            text: String(row.text ?? ""),
            found: row.found === true,
          };
        })
      : [],
  };
  applyGrounding(
    state,
    groundingFromBrowserSession(session, url, { hypothesisIds }),
  );
}

/** Ground from a full OAV cycle result. */
export function groundObserveActVerify(
  state: TaskState,
  result: ObserveActVerifyResult,
  hypothesisIds?: string[],
) {
  const relation = result.verify.passed ? "supports" : "contradicts";
  applyGrounding(state, {
    refs: result.evidenceRefs,
    summary: result.verify.summary,
    source: result.evidenceRefs.some((ref) => ref.startsWith("screenshot:"))
      ? "screenshot"
      : "dom",
    hypothesisIds,
    relation,
  });
}
