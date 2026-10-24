"use client";

import Link from "next/link";
import { useState } from "react";

const COOKIE = "osirus-consent";
const YEAR = 60 * 60 * 24 * 365;

export type ConsentChoice = "necessary" | "all";

function writeChoice(choice: ConsentChoice) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${choice}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
}

/**
 * Non-essential storage waits for a choice. Osirus sets none today.
 * The consent cookie itself only remembers that choice.
 * The server passes the stored choice so the first paint matches.
 */
export function CookieBanner({
  initialChoice,
}: {
  initialChoice: ConsentChoice | null;
}) {
  const [choice, setChoice] = useState(initialChoice);

  if (choice) return null;

  const choose = (next: ConsentChoice) => {
    writeChoice(next);
    setChoice(next);
  };

  return (
    <div
      className="cookie-banner"
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      lang="de"
    >
      <div className="cookie-banner-copy">
        <p id="cookie-banner-title">Cookies</p>
        <p>
          Notwendige Cookies halten die Anmeldung und diese Entscheidung.
          Optionale Cookies setzt Osirus erst nach Einwilligung. Derzeit sind
          keine optionalen Cookies im Einsatz.{" "}
          <Link href="/legal/cookies">Cookie-Hinweis</Link>
        </p>
      </div>
      <div className="cookie-banner-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => choose("necessary")}
        >
          Nur notwendige
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => choose("all")}
        >
          Alle akzeptieren
        </button>
      </div>
    </div>
  );
}
