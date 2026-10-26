import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  hasMath,
  Markdown,
  prepareMath,
} from "../src/components/chat/markdown";

describe("math in answers", () => {
  it("turns \\( \\) and \\[ \\] into dollar math and keeps amounts as text", () => {
    expect(prepareMath("Sei \\(x^2\\) und \\[\\sum_i i\\]")).toBe(
      "Sei $x^2$ und $$\\sum_i i$$",
    );
    expect(prepareMath("Kostet $5 und $10.99.")).toBe(
      "Kostet \\$5 und \\$10.99.",
    );
    expect(prepareMath("$2^n$ wächst")).toBe("$2^n$ wächst");
    expect(prepareMath("`echo $5` und ```\n$HOME \\(x\\)\n```")).toBe(
      "`echo $5` und ```\n$HOME \\(x\\)\n```",
    );
  });

  it("loads KaTeX only for answers that contain math", () => {
    expect(hasMath("Euklid: $N = p_1 + 1$")).toBe(true);
    expect(hasMath("Sei \\(x\\)")).toBe(true);
    expect(hasMath("Kostet $5.")).toBe(false);
    expect(hasMath("Ganz normaler Text")).toBe(false);
    // Server render (and the first client render) shows the text as is.
    const html = renderToStaticMarkup(
      createElement(Markdown, { content: "Kostet $5." }),
    );
    expect(html).toContain("Kostet $5.");
    expect(html).not.toContain("katex");
  });
});
