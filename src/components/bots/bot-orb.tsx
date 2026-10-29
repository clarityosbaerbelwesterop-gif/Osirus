import type { CSSProperties } from "react";
import { cx } from "../ui/cx";

// A bot's face: a living orb in the bot's own colours. Its motion says what
// the bot is doing: resting, listening, thinking or speaking. Colours come
// from the bot's id, so every bot keeps the same orb everywhere.

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

/** Three related hues from a stable seed (a bot id). */
export function orbHues(seed: string): [number, number, number] {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const base = Math.abs(hash) % 360;
  return [base, (base + 48) % 360, (base + 132) % 360];
}

export function BotOrb({
  seed,
  size = 32,
  state = "idle",
  className,
  hues,
}: {
  seed: string;
  size?: number;
  state?: OrbState;
  className?: string;
  /** Fixed colours for a surface's own orb (Rouge Agent, Code). */
  hues?: [number, number, number];
}) {
  const [h1, h2, h3] = hues ?? orbHues(seed);
  return (
    <span
      className={cx("orb", `orb-${state}`, className)}
      style={
        {
          "--orb-size": `${size}px`,
          "--orb-h1": h1,
          "--orb-h2": h2,
          "--orb-h3": h3,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className="orb-glow" />
      <span className="orb-core" />
      <span className="orb-shine" />
    </span>
  );
}
