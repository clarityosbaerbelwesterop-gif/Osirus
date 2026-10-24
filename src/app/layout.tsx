import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import {
  CookieBanner,
  type ConsentChoice,
} from "@/components/legal/cookie-banner";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/preferences";
import { publicSiteUrl } from "./site-url";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: { default: "Osirus", template: "%s · Osirus" },
  description:
    "Osirus ist ein Workspace für Assistent, Work und Agents. Modelle laufen über UNOROUTER.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Osirus",
    title: "Osirus — Bots, Work und Agents",
    description:
      "Workspace für Assistent, Work und Agents. Modelle über UNOROUTER.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Osirus — Bots, Work und Agents",
    description:
      "Workspace für Assistent, Work und Agents. Modelle über UNOROUTER.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e17" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const consent = jar.get("osirus-consent")?.value;
  const initialChoice: ConsentChoice | null =
    consent === "all" || consent === "necessary" ? consent : null;
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>
        {children}
        <CookieBanner initialChoice={initialChoice} />
      </body>
    </html>
  );
}
