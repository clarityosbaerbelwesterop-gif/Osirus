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
        <h1>That request could not be completed.</h1>
        <p>No private diagnostic information is displayed here.</p>
        <button type="button" className="btn btn-secondary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
