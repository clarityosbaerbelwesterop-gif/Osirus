"use client";

import { useEffect, useState } from "react";
import { withoutOwnModel } from "../motion/public-text";

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
      aria-label="Modell-Routing"
      data-training={String(snapshot.trainingStarted)}
      data-production={String(snapshot.production)}
    >
      <h3>Modellrouten</h3>
      <p className="subtle">
        Live-Routing für UNOROUTER. Der Punkt bewegt sich nur, solange dieser
        Prozess tatsächlich Anfragen an den gezeigten Anbieter senden würde.
        Eigene Modelle werden nicht angeboten. Nichts hier ist eine
        Trainingsanimation. Das Training wurde nicht gestartet. Beobachtet{" "}
        {snapshot.observedAt}.
      </p>
      {snapshot.tracks.length === 0 ? (
        <p>In diesem Build sind keine Track-Definitionen registriert.</p>
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
                <strong>{withoutOwnModel(track.displayName)}</strong>
                <div>{withoutOwnModel(track.nativeSummary)}</div>
                <div>
                  {track.blocked ? "Nicht verbunden — API-Key fehlt. " : ""}
                  Kein nativer Checkpoint.
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
