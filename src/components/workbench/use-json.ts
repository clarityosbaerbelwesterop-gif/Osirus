"use client";

import { useCallback, useEffect, useState } from "react";

/** Load JSON from an endpoint, optionally refreshing while a run is live. */
export function useJson<T>(url: string | null, refreshMs: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        setError(
          response.status === 404 ? "not_found" : `HTTP ${response.status}`,
        );
        return;
      }
      setData((await response.json()) as T);
      setError(null);
    } catch {
      setError("unreachable");
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    // Deferred so the effect itself never sets state synchronously.
    const first = window.setTimeout(() => void load(), 0);
    const timer = refreshMs
      ? window.setInterval(() => void load(), refreshMs)
      : null;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [load, refreshMs]);
  return { data, error, loading, reload: load };
}
