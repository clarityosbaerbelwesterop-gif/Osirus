"use client";

import { useEffect, useState } from "react";

export type LabRoutingSnapshot = {
  observedAt: string;
  trainingStarted: false;
  production: false;
  tracks: readonly {
    trackId: string;
    displayName: string;
    nativeModelId: string;
    nativeSummary: string;
    routeProvider: "native" | "unorouter";
    routeLabel: string;
    routeModelId: string;
    routeReason: string;
    live: boolean;
    blocked: boolean;
    evaluationState: string;
    fallbackNote: string;
  }[];
};

export function LabRoutingPanel({ initial }: { initial: LabRoutingSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch("/api/lab/routing", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as LabRoutingSnapshot;
        })
        .then((body) => {
          if (!cancelled && body && Array.isArray(body.tracks))
            setSnapshot(body);
        })
        .catch(() => {
          // Keep the last snapshot. A failed poll is not a successful route.
        });
    };
    const id = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section
      className="lab-routing"
      aria-label="Model routing"
      data-training={String(snapshot.trainingStarted)}
      data-production={String(snapshot.production)}
    >
      <h3>Model routes</h3>
      <p className="subtle">
        Live routing for ROUGE 1, QUASNIR, and DARUS. The dot moves only while
        this process would actually send inference to the shown provider.
        Nothing here is a training animation. Training has not been started.
        Observed {snapshot.observedAt}.
      </p>
      {snapshot.tracks.length === 0 ? (
        <p>No track definitions are registered in this build.</p>
      ) : (
        <ul className="lab-route-list">
          {snapshot.tracks.map((track) => (
            <li key={track.trackId} className="lab-route">
              <span
                className="lab-route-dot"
                data-live={track.live ? "true" : "false"}
                data-blocked={track.blocked ? "true" : "false"}
                data-provider={
                  track.routeProvider === "native" ? "native" : "api"
                }
                aria-hidden="true"
              />
              <div>
                <strong>{track.displayName}</strong>
                <div>{track.nativeSummary}</div>
                <div>
                  {track.blocked ? "Not connected — API key missing. " : ""}
                  Not a native checkpoint.
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
