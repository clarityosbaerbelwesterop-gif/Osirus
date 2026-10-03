"use client";

import { OsirusMark } from "../shell/osirus-mark";

/**
 * Empty Chat. One mark and the product name. The composer sits under this
 * column. No checklist and no description of steps.
 */
export function ChatHome() {
  return (
    <div className="home home-calm">
      <OsirusMark size={44} />
      <p className="home-title">Osirus</p>
    </div>
  );
}
