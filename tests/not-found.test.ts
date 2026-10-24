import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: (props: {
    href: string;
    children?: ReactNode;
    className?: string;
  }) =>
    createElement(
      "a",
      { href: props.href, className: props.className },
      props.children,
    ),
}));

import NotFound from "../src/app/not-found";

describe("not found", () => {
  it("is German, on brand, and links home plus the legal pages", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("Diese Seite gibt es nicht");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain("status-rise");
    expect(html).not.toContain("Page not found");
  });
});
