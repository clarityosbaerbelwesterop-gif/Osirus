import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/preferences";
import { publicSiteUrl, searchVerification } from "./site-url";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: {
    default: "Osirus – Dein KI-Team mit Freigabeknopf",
    template: "%s · Osirus",
  },
  description:
    "Osirus von ClarityCompassAI ist dein KI-Team für Chat, Aufgaben und Code. Antworten mit Quellen, das passende Modell wählt Osirus selbst, jede Aktion nach außen erst nach deiner Freigabe. Gehostet in der EU.",
  robots: { index: true, follow: true },
  verification: searchVerification(),
  // Stable, crawlable icons for the Google Search result favicon.
  // Google wants a square icon, larger than 48px, declared with rel="icon"
  // at a URL that does not change (not a hashed Next.js icon path).
  icons: {
    icon: [
      { url: "/icon-96.png", type: "image/png", sizes: "96x96" },
      { url: "/icon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Osirus",
    title: "Osirus – Dein KI-Team mit Freigabeknopf",
    description:
      "Antworten mit Quellen, autonome Aufgaben und Code in einem Workspace, mit Freigabe vor jeder Aktion nach außen. Von ClarityCompassAI, gehostet in der EU.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Osirus – Dein KI-Team mit Freigabeknopf",
    description:
      "Antworten mit Quellen, autonome Aufgaben und Code in einem Workspace, mit Freigabe vor jeder Aktion nach außen. Von ClarityCompassAI, gehostet in der EU.",
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
  return (
    <html lang="de" data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
