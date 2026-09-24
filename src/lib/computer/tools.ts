import { z } from "zod";
import {
  evidenceRefsForBrowser,
  formatObserveActVerify,
  observeActVerifyFromSession,
} from "../agent/observe-act-verify";
import type { SandboxHandle } from "../sandbox/driver";
import type { ToolDefinition } from "../tools/registry";
import { SandboxBrowser, type BrowserAction } from "./browser";

// computer.inspect: look at the app running in the workspace the way a user
// would. It opens a page served inside the sandbox (localhost only -- it
// cannot browse the internet), performs up to ten typed actions, and returns
// what happened: status, console errors, failed requests, each action's
// result, visible text, accessibility counts and layout at three widths.
// Reading the sandbox changes nothing outside it, so it needs no approval.

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: z.string().min(1).max(200) }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().min(1).max(200),
    text: z.string().max(500),
  }),
  z.object({ type: z.literal("press"), key: z.string().min(1).max(30) }),
  z.object({ type: z.literal("wait"), selector: z.string().min(1).max(200) }),
]);

export function computerTools(handle: () => SandboxHandle): ToolDefinition[] {
  let browser: SandboxBrowser | null = null;
  return [
    {
      id: "computer.inspect",
      title: "Use the app in a browser",
      summary:
        "Open a page of the app running in the workspace (localhost port), click, type and wait, and get back what a user would see: errors, failed requests, text, accessibility and layout at desktop, iPad and phone width.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ["coding", "building"],
      inputSchema: z.object({
        port: z.number().int().min(1024).max(65535).default(4173),
        path: z
          .string()
          .max(300)
          .regex(/^\/[^\s]*$/)
          .default("/"),
        actions: z.array(action).max(10).optional(),
        expectText: z.array(z.string().min(1).max(200)).max(10).optional(),
      }),
      run: async (input) => {
        const request = input as {
          port: number;
          path: string;
          actions?: BrowserAction[];
          expectText?: string[];
        };
        browser ??= new SandboxBrowser(handle());
        const url = `http://127.0.0.1:${request.port}${request.path}`;
        const session = await browser.session({
          url,
          actions: request.actions,
          texts: request.expectText,
        });
        const oav = observeActVerifyFromSession(url, session, {
          texts: request.expectText,
        });
        const evidenceRefs = evidenceRefsForBrowser(url, session);
        return {
          url,
          status: session.status,
          title: session.title,
          error: session.error ?? null,
          consoleErrors: session.consoleErrors.slice(0, 10),
          failedRequests: session.failedRequests.slice(0, 10),
          actions: session.actions,
          expectedText: session.texts,
          accessibility: session.a11y,
          layout: session.viewports.map((viewport) => ({
            viewport: viewport.name,
            horizontalOverflow: viewport.horizontalOverflow,
          })),
          visibleText: (session.visibleText ?? "").slice(0, 2_000),
          verify: {
            passed: oav.verify.passed,
            mode: oav.verify.mode,
            failedChecks: oav.verify.failedCheckIds,
            summary: oav.verify.summary,
          },
          evidenceRefs,
          groundingSummary: formatObserveActVerify(oav),
        };
      },
    },
  ];
}
