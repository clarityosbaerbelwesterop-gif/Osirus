import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseSidebar,
  parseTheme,
  writePreference,
} from "../src/lib/ui/preferences";

function stubCookieSink() {
  const sink = { value: "" };
  vi.stubGlobal("document", {
    set cookie(cookie: string) {
      sink.value = cookie;
    },
  });
  return sink;
}

describe("preference cookies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks cookies Secure over https but not over plain http (localhost dev)", () => {
    const sink = stubCookieSink();

    vi.stubGlobal("location", { protocol: "https:" });
    writePreference("osirus-theme", "dark");
    expect(sink.value).toContain("osirus-theme=dark");
    expect(sink.value).toContain("Path=/");
    expect(sink.value).toContain("SameSite=Lax");
    expect(sink.value).toContain("Secure");

    vi.stubGlobal("location", { protocol: "http:" });
    writePreference("osirus-theme", "light");
    expect(sink.value).not.toContain("Secure");
  });

  it("encodes values before writing", () => {
    const sink = stubCookieSink();
    vi.stubGlobal("location", { protocol: "https:" });
    writePreference("osirus-sidebar", "a b");
    expect(sink.value).toContain("osirus-sidebar=a%20b");
  });

  it("parses only known values and falls back to defaults", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("junk")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseSidebar("collapsed")).toBe("collapsed");
    expect(parseSidebar("junk")).toBe("expanded");
    expect(parseSidebar(null)).toBe("expanded");
  });
});
