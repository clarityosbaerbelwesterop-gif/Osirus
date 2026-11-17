"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Osirus route error", { digest: error.digest });
  }, [error]);

  return (
    <main className="status-page">
      <section className="status-card">
        <p className="overline">Osirus</p>
        <h1>Diese Anfrage konnte nicht abgeschlossen werden.</h1>
        <p>Hier werden keine privaten Diagnosedaten angezeigt.</p>
        <button type="button" className="btn btn-secondary" onClick={reset}>
          Erneut versuchen
        </button>
      </section>
    </main>
  );
}
