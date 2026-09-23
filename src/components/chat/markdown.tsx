"use client";

import { Check, Copy } from "lucide-react";
import { memo, useRef, useState, type ComponentProps } from "react";
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

export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
