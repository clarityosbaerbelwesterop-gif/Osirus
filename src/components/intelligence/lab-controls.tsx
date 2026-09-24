"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FoundrySettings } from "@/lib/intelligence/types";
import { Button } from "../ui/button";

// Operator controls: run a tick now, and switch Foundry subsystems. Only the
// switches that do something are shown; training stays off until a real
// training provider exists, and the server refuses it anyway.

type Flag = keyof FoundrySettings["flags"];

const SWITCHES: Array<{ flag: Flag; label: string }> = [
  { flag: "intelligencePlane", label: "Foundry" },
  { flag: "experiments", label: "Experiments" },
  { flag: "curriculum", label: "Curriculum" },
  { flag: "selfPlay", label: "Self-play" },
  { flag: "redIntelligence", label: "Red intelligence" },
  { flag: "compilation", label: "Experience compilation" },
  { flag: "strategyEvolution", label: "Strategy evolution" },
  { flag: "skillEvolution", label: "Skill evolution" },
  { flag: "autoCanary", label: "Low-risk auto canary" },
];

export function LabControls({
  settings,
  canRunNow,
}: {
  settings: FoundrySettings;
  canRunNow: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(key: string, url: string, body?: unknown) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setMessage(
          data.error === "production_only"
            ? "Run now works on the production deployment only."
            : "That did not work. Try again.",
        );
        return;
      }
      if (key === "run")
        setMessage("A tick was requested; the page updates as it works.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="row row-wrap">
        {canRunNow ? (
          <Button
            icon={Play}
            variant="primary"
            disabled={busy !== null}
            onClick={() => void send("run", "/api/internal/intelligence/run")}
          >
            Run a tick now
          </Button>
        ) : null}
      </div>
      <fieldset className="lab-switches">
        <legend className="lab-meta">Subsystems</legend>
        {SWITCHES.map(({ flag, label }) => (
          <label key={flag} className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={settings.flags[flag]}
              disabled={busy !== null}
              onChange={(event) =>
                void send(flag, "/api/internal/intelligence/settings", {
                  flags: { [flag]: event.target.checked },
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {message ? (
        <p className="lab-meta" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
