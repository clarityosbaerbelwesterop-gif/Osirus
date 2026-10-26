"use client";

import { Sparkles } from "lucide-react";
import { openTour } from "../shell/onboarding-tour";

/** Opens the introduction tour again; nothing about the account changes. */
export function ReplayTour() {
  return (
    <button type="button" className="btn btn-secondary" onClick={openTour}>
      <Sparkles size={14} aria-hidden="true" />
      Einführung ansehen
    </button>
  );
}
