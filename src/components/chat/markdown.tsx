"use client";

import { Check, Copy, LoaderCircle, Play } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { runnableLanguage } from "@/lib/chat/run-code";

// Model output rendered as Markdown, safely.
//
// Raw HTML in the source is never rendered (react-markdown escapes it without
// a raw-HTML plugin, and none is installed). URLs pass through the default
// transform, which drops javascript:, vbscript: and data: schemes. Images are
// shown as links: the page's CSP blocks remote images anyway, and a link does
// not fetch anything (no tracking pixels).

/** Whether code blocks here may offer "Ausführen" (signed-in surfaces only). */
const RunnableContext = createContext(false);

type RunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

type RunState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; result: RunResult }
  | { state: "error"; message: string };

function RunOutput({ run }: { run: RunState }) {
  if (run.state === "idle") return null;
  if (run.state === "running")
    return (
      <div className="md-run" role="status" aria-live="polite">
        <p className="md-run-head">Läuft in der Sandbox…</p>
      </div>
    );
  if (run.state === "error")
    return (
      <div className="md-run md-run-failed" role="status" aria-live="polite">
        <p className="md-run-head">{run.message}</p>
      </div>
    );
  const { result } = run;
  const ok = result.exitCode === 0;
  const head = result.timedOut
    ? "Zeitlimit erreicht"
    : ok
      ? "Erfolgreich"
      : `Fehlgeschlagen (Exit ${result.exitCode ?? "?"})`;
  return (
    <div
      className={ok ? "md-run md-run-ok" : "md-run md-run-failed"}
      role="status"
      aria-live="polite"
    >
      <p className="md-run-head">
        {head} · {(result.durationMs / 1000).toFixed(1)} s
      </p>
      {result.stdout ? <pre className="md-run-out">{result.stdout}</pre> : null}
      {result.stderr ? <pre className="md-run-err">{result.stderr}</pre> : null}
      {!result.stdout && !result.stderr ? (
        <p className="md-run-empty">Keine Ausgabe.</p>
      ) : null}
    </div>
  );
}

function CodeBlock(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const runnable = useContext(RunnableContext);
  const child = Array.isArray(props.children)
    ? props.children[0]
    : props.children;
  const className =
    child && typeof child === "object" && "props" in child
      ? String((child.props as { className?: string }).className ?? "")
      : "";
  const language = className.match(/language-([\w+#-]+)/)?.[1] ?? null;
  const canRun = runnable && runnableLanguage(language) !== null;

  const copy = async () => {
    const text = ref.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const execute = async () => {
    if (run.state === "running") return;
    setRun({ state: "running" });
    const response = await fetch("/api/chat/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language,
        code: ref.current?.textContent ?? "",
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      (RunResult & { ok?: boolean; message?: string; error?: string }) | null;
    if (!response?.ok || !body?.ok) {
      setRun({
        state: "error",
        message:
          body?.message ??
          (response?.status === 429
            ? "Zu viele Ausführungen in kurzer Zeit. Bitte warte einen Moment."
            : "Der Code konnte nicht ausgeführt werden."),
      });
      return;
    }
    setRun({ state: "done", result: body });
  };

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{language ?? "text"}</span>
        <span className="md-code-actions">
          {canRun ? (
            <button
              type="button"
              className="md-code-copy"
              onClick={() => void execute()}
              disabled={run.state === "running"}
              aria-label="Code in der Sandbox ausführen"
            >
              {run.state === "running" ? (
                <LoaderCircle size={13} aria-hidden="true" className="spin" />
              ) : (
                <Play size={13} aria-hidden="true" />
              )}
              <span>Ausführen</span>
            </button>
          ) : null}
          <button
            type="button"
            className="md-code-copy"
            onClick={() => void copy()}
            aria-label={copied ? "Kopiert" : "Code kopieren"}
          >
            {copied ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
            <span>{copied ? "Kopiert" : "Kopieren"}</span>
          </button>
        </span>
      </div>
      <pre ref={ref}>{props.children}</pre>
      <RunOutput run={run} />
    </div>
  );
}

const components: Components = {
  a: (props) => {
    const { href, children } = props;
    // Keep only the attributes remark-gfm uses for footnotes.
    const rest = Object.fromEntries(
      Object.entries(props).filter(
        ([key]) =>
          key.startsWith("data-") || key === "id" || key === "aria-describedby",
      ),
    );
    const internal = typeof href === "string" && href.startsWith("#");
    return internal ? (
      <a href={href} {...rest}>
        {children}
      </a>
    ) : (
      <a
        href={href}
        {...rest}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : null;
    if (!url) return alt ? <span>{alt}</span> : null;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">
        {alt ? `Bild: ${alt}` : "Bild"}
      </a>
    );
  },
  pre: (props) => <CodeBlock {...props} />,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={Boolean(checked)} readOnly disabled />
    ) : null,
};

function urlTransform(url: string) {
  return defaultUrlTransform(url);
}

/**
 * Math as models write it: \(...\) and \[...\] become $...$ and $$...$$.
 * A dollar before an amount ("$5 and $10") stays a dollar sign. Code is
 * left untouched.
 */
/**
 * open...close becomes fence...fence, scanning once with indexOf. The
 * former regex /\\\[([\s\S]+?)\\\]/ took quadratic time on many unclosed
 * "\[" and froze the tab (also for anonymous share viewers).
 */
function wrapMath(text: string, open: string, close: string, fence: string) {
  let out = "";
  let at = 0;
  for (;;) {
    const start = text.indexOf(open, at);
    if (start < 0) break;
    const end = text.indexOf(close, start + open.length + 1);
    if (end < 0) break;
    out +=
      text.slice(at, start) +
      fence +
      text.slice(start + open.length, end) +
      fence;
    at = end + close.length;
  }
  return out + text.slice(at);
}

export function prepareMath(source: string) {
  return source
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : wrapMath(
            wrapMath(part, "\\[", "\\]", "$$"),
            "\\(",
            "\\)",
            "$",
          ).replace(
            /(^|[^\\$])\$(\d[\d.,]*)(?=\s|$|[.,;:!?)\]/-])/gm,
            "$1\\$$$2",
          ),
    )
    .join("");
}

/** True when the text has something KaTeX would render. */
export function hasMath(source: string) {
  return /\$[^$\n]+\$|\$\$|\\\(|\\\[/.test(source);
}

type MathPlugins = {
  remark: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
  rehype: NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
};

// KaTeX (about 60 KB) is loaded only once an answer contains math.
let mathPlugins: MathPlugins | null = null;
let mathLoading: Promise<MathPlugins> | null = null;

function loadMath() {
  mathLoading ??= Promise.all([
    import("remark-math"),
    import("rehype-katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([remarkMath, rehypeKatex]) => {
    mathPlugins = {
      remark: [remarkGfm, remarkMath.default],
      rehype: [[rehypeKatex.default, { throwOnError: false, strict: false }]],
    };
    return mathPlugins;
  });
  return mathLoading;
}

const plainPlugins = [remarkGfm];

export const Markdown = memo(function Markdown({
  content,
  runnable = false,
}: {
  content: string;
  /** Offer "Ausführen" on Python, JavaScript and TypeScript blocks. */
  runnable?: boolean;
}) {
  const wantsMath = hasMath(content);
  const [plugins, setPlugins] = useState<MathPlugins | null>(mathPlugins);
  useEffect(() => {
    if (!wantsMath || plugins) return;
    let alive = true;
    void loadMath().then((loaded) => {
      if (alive) setPlugins(loaded);
    });
    return () => {
      alive = false;
    };
  }, [plugins, wantsMath]);
  const math = wantsMath ? plugins : null;
  return (
    <RunnableContext.Provider value={runnable}>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={math ? math.remark : plainPlugins}
          rehypePlugins={math ? math.rehype : undefined}
          components={components}
          urlTransform={urlTransform}
        >
          {math ? prepareMath(content) : content}
        </ReactMarkdown>
      </div>
    </RunnableContext.Provider>
  );
});
