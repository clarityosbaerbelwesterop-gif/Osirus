import { writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  ALL_ARENAS,
  arenaById,
} from "../src/lib/intelligence/generation/arenas";
import { playArena } from "../src/lib/intelligence/generation/challenges";

// Measure arenas on the source tree as it is right now. The software-RSI
// pipeline runs this in a fresh process before and after a patch, so the
// numbers always come from the code on disk, never from a module cached in
// the pipeline's own process.
//
//   RSI_ARENAS  comma list of arena ids, or "all"
//   RSI_LEVELS  comma list of levels, or "all"
//   RSI_SEEDS   comma list of seeds
//   RSI_COUNT   instances per (arena, level, seed)
//   RSI_OUT     where to write the JSON

it("measures arenas", async () => {
  const arenas =
    (process.env.RSI_ARENAS ?? "all") === "all"
      ? ALL_ARENAS
      : (process.env.RSI_ARENAS ?? "")
          .split(",")
          .map((id) => arenaById(id.trim()))
          .filter((arena) => arena !== null);
  const seeds = (process.env.RSI_SEEDS ?? "m1").split(",").map((s) => s.trim());
  const count = Number(process.env.RSI_COUNT ?? "4");
  const rows = [];
  for (const arena of arenas) {
    const levels =
      (process.env.RSI_LEVELS ?? "all") === "all"
        ? Array.from({ length: arena.maxLevel }, (_, index) => index + 1)
        : (process.env.RSI_LEVELS ?? "1")
            .split(",")
            .map(Number)
            .filter((level) => level >= 1 && level <= arena.maxLevel);
    for (const level of levels)
      for (const seed of seeds) {
        const round = await playArena(arena, { seed, level, count });
        rows.push({
          arena: arena.id,
          level,
          seed,
          held: round.held,
          failed: round.failed,
          invalid: round.invalid,
          instances: round.instances,
          failures: round.failures.slice(0, 3).map((failure) => ({
            detail: failure.detail,
            text: failure.text,
          })),
        });
      }
  }
  await writeFile(
    process.env.RSI_OUT ?? "rsi-measure.json",
    JSON.stringify(rows),
  );
  expect(rows.length).toBeGreaterThan(0);
});
