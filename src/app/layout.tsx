import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/preferences";
import { publicSiteUrl, searchVerification } from "./site-url";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: { default: "Osirus", template: "%s · Osirus" },
  description:
    "Osirus: dein KI-Team für Chat, autonome Aufgaben und Code. Jede Aktion nach außen wartet auf deine Freigabe.",
  robots: { index: true, follow: true },
  verification: searchVerification(),
  openGraph: {
    type: "website",
    siteName: "Osirus",
    title: "Osirus — Dein KI-Team mit Freigabeknopf",
    description:
      "Antworten mit Quellen, autonome Aufgaben und Code in einem Workspace, mit Freigabe vor jeder Aktion nach außen. Gehostet in der EU.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Osirus — Dein KI-Team mit Freigabeknopf",
    description:
      "Antworten mit Quellen, autonome Aufgaben und Code in einem Workspace, mit Freigabe vor jeder Aktion nach außen. Gehostet in der EU.",
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
