"use client";

import { Check, Copy } from "lucide-react";
import { memo, useEffect, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";

// Model output rendered as Markdown, safely.
//
// Raw HTML in the source is never rendered (react-markdown escapes it without
// a raw-HTML plugin, and none is installed). URLs pass through the default
// transform, which drops javascript:, vbscript: and data: schemes. Images are
// shown as links: the page's CSP blocks remote images anyway, and a link does
// not fetch anything (no tracking pixels).

function CodeBlock(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(props.children)
    ? props.children[0]
    : props.children;
  const className =
    child && typeof child === "object" && "props" in child
      ? String((child.props as { className?: string }).className ?? "")
      : "";
  const language = className.match(/language-([\w+#-]+)/)?.[1] ?? null;

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

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{language ?? "text"}</span>
        <button
          type="button"
          className="md-code-copy"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre ref={ref}>{props.children}</pre>
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
        {alt ? `Image: ${alt}` : "Image"}
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
export function prepareMath(source: string) {
  return source
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `$$${math}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`)
            .replace(
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
}: {
  content: string;
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
  );
});
