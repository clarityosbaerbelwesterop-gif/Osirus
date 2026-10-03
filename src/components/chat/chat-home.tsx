"use client";

import { useShell } from "../shell/shell-context";
import { OsirusMark } from "../shell/osirus-mark";

/**
 * Empty Chat. One mark and the signed-in person's name. The composer sits
 * under this column. The product name is not the heading.
 */
export function ChatHome() {
  const name = useShell().user.name?.trim();
  return (
    <div className="home home-calm">
      <OsirusMark size={44} />
      <p className="home-title">
        {name ? `Wieder am Start, ${name}` : "Wieder am Start"}
      </p>
    </div>
  );
}
