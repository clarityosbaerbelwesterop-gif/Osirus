import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const email = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const requireAuthConfiguration = vi.hoisted(() => vi.fn());

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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuthConfiguration,
  auth: { signUp: { email } },
}));

import { signUpWithEmail } from "../src/app/auth/sign-up/actions";
import { SignUpForm } from "../src/app/auth/sign-up/sign-up-form";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("sign-up legal acceptance", () => {
  beforeEach(() => {
    email.mockClear();
    requireAuthConfiguration.mockClear();
  });

  it("renders both checkboxes unchecked and keeps both buttons disabled", () => {
    const html = renderToStaticMarkup(createElement(SignUpForm, {}));
    expect(html).toContain("Ich akzeptiere die");
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/eula"');
    expect(html).toContain("Ich habe die");
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain("Konto erstellen");
    expect(html).toContain("Weiter mit GitHub");
    const disabled = html.match(/disabled=""/g) ?? [];
    expect(disabled.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('checked=""');
  });

  it("rejects email sign-up on the server when the boxes are missing", async () => {
    const result = await signUpWithEmail(
      null,
      form({
        name: "Ada",
        email: "ada@example.com",
        password: "long-enough",
      }),
    );
    expect(result?.error).toMatch(/AGB/);
    expect(email).not.toHaveBeenCalled();
    expect(requireAuthConfiguration).not.toHaveBeenCalled();
  });

  it("continues only after both boxes are accepted", async () => {
    await expect(
      signUpWithEmail(
        null,
        form({
          name: "Ada",
          email: "ada@example.com",
          password: "long-enough",
          acceptTerms: "on",
          acceptPrivacy: "on",
        }),
      ),
    ).rejects.toThrow("redirect:/app");
    expect(requireAuthConfiguration).toHaveBeenCalled();
    expect(email).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      password: "long-enough",
    });
  });
});

describe("sign-up failures", () => {
  beforeEach(() => email.mockClear());

  it("names an existing account and keeps what was typed", async () => {
    email.mockResolvedValueOnce({
      error: { code: "USER_ALREADY_EXISTS", status: 422 },
    } as never);
    const result = await signUpWithEmail(
      null,
      form({
        name: "Ada",
        email: "ada@example.com",
        password: "long-enough",
        acceptTerms: "on",
        acceptPrivacy: "on",
      }),
    );
    expect(result?.exists).toBe(true);
    expect(result?.error).toMatch(/schon ein Konto/);
    expect(result?.values).toEqual({ name: "Ada", email: "ada@example.com" });
    const html = renderToStaticMarkup(createElement(SignUpForm, {}));
    expect(html).not.toContain("Zur Anmeldung");
  });

  it("tells a breached password apart from an existing account", async () => {
    const { signUpFailure } = await import("../src/app/auth/sign-up/actions");
    await expect(
      signUpFailure({ code: "PASSWORD_COMPROMISED", status: 400 }),
    ).resolves.toMatchObject({ exists: false, message: /Datenleck/ });
    await expect(
      signUpFailure({ code: "INVALID_EMAIL", status: 400 }),
    ).resolves.toMatchObject({ exists: false, message: /ungültig/ });
    await expect(
      signUpFailure({ message: "User already exists" }),
    ).resolves.toMatchObject({ exists: true });
    await expect(signUpFailure({ code: "SOMETHING" })).resolves.toMatchObject({
      exists: false,
      message: /erneut/,
    });
  });
});
