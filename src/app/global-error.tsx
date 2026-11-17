"use client";

import { useEffect } from "react";

// The last resort when the root layout itself fails (or the platform cannot
// route a request at all). It replaces the whole document, so the app's
// stylesheet is not there: styles are inline and the page stands alone.
// Without it, Next showed its own English "This page couldn't load".

const page: React.CSSProperties = {
  minHeight: "100vh",
  margin: 0,
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "#0b0b0f",
  color: "#ededf2",
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const card: React.CSSProperties = {
  maxWidth: "420px",
  display: "grid",
  gap: "12px",
};

const button: React.CSSProperties = {
  justifySelf: "start",
  padding: "10px 14px",
  border: 0,
  borderRadius: "8px",
  background: "#ededf2",
  color: "#0b0b0f",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

const links: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "14px",
  fontSize: "14px",
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Osirus global error", { digest: error.digest });
  }, [error]);

  return (
    <html lang="de">
      <body style={page}>
        <main style={card}>
          <p style={{ margin: 0, opacity: 0.7, fontSize: "14px" }}>Osirus</p>
          <h1 style={{ margin: 0, fontSize: "24px", lineHeight: 1.3 }}>
            Diese Seite konnte gerade nicht geladen werden.
          </h1>
          <p style={{ margin: 0, opacity: 0.8 }}>
            Bitte lade sie neu. Bleibt der Fehler, versuch es in einem Moment
            noch einmal. Deine Daten sind davon nicht betroffen.
          </p>
          <button type="button" style={button} onClick={reset}>
            Neu laden
          </button>
          <nav style={links} aria-label="Weiter">
            {/* Plain links on purpose: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "inherit" }}>
              Startseite
            </a>
            <a href="/legal/impressum" style={{ color: "inherit" }}>
              Impressum
            </a>
            <a href="/legal/privacy" style={{ color: "inherit" }}>
              Datenschutz
            </a>
          </nav>
        </main>
      </body>
    </html>
  );
}
