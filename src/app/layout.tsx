import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/preferences";
import { publicSiteUrl, searchVerification } from "./site-url";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: {
    default: "Osirus AI — Dein KI-Team mit Freigabeknopf | ClarityCompassAI",
    template: "%s · Osirus AI",
  },
  description:
    "Osirus von ClarityCompassAI ist dein KI-Team für Chat, Aufgaben und Code. Antworten mit Quellen, das passende Modell wählt Osirus selbst, jede Aktion nach außen erst nach deiner Freigabe. Gehostet in der EU.",
  robots: { index: true, follow: true },
  verification: searchVerification(),
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "Osirus AI",
    title: "Osirus AI — Dein KI-Team mit Freigabeknopf | ClarityCompassAI",
    description:
      "Antworten mit Quellen, autonome Aufgaben und Code in einem Workspace, mit Freigabe vor jeder Aktion nach außen. Von ClarityCompassAI, gehostet in der EU.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Osirus AI — Dein KI-Team mit Freigabeknopf | ClarityCompassAI",
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
