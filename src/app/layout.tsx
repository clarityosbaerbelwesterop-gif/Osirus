import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/preferences";

export const metadata: Metadata = {
  metadataBase: new URL("https://osirus.vercel.app"),
  title: { default: "Osirus", template: "%s · Osirus" },
  description:
    "An agent workspace that plans, acts with approval, and verifies its work.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Osirus",
    title: "Osirus — an agent that finishes the work, and shows it",
    description:
      "An agent workspace that plans, acts with approval, and verifies its work.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Osirus — an agent that finishes the work, and shows it",
    description:
      "An agent workspace that plans, acts with approval, and verifies its work.",
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
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
