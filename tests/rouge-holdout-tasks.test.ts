import { describe, expect, it } from "vitest";
import { KERNEL_HOLDOUT } from "../evals/rouge/kernel-holdout-tasks";

// The M57 holdout judges the kernel; its checkers must judge answers, not
// wording. Each accepts its right answer and rejects a close wrong one.

const right: Record<string, string> = {
  "h-percent": "36",
  "h-planet": "Jupiter",
  "h-seconds": "3600",
  "h-prime": "no",
  "h-power": "4096",
  "h-author": "Austen",
  "h-bronze": "copper tin",
  "h-json-sum": '{"sum": 42}',
  "h-month": "Februar",
  "h-pens": "8",
  "h-sort": "2, 4, 7, 9",
  "h-coins": "1/4",
  "h-vowels": "5",
  "h-fahrenheit": "38",
  "h-days-ago": "Tuesday",
  "h-floor-div": "3",
  "h-letters": "9",
  "h-larger": "0.7",
  "h-translate": "Danke",
  "h-capital": "Canberra",
};
const wrong: Record<string, string> = {
  "h-percent": "24",
  "h-planet": "Saturn",
  "h-seconds": "360",
  "h-prime": "yes",
  "h-power": "2048",
  "h-author": "Bronte",
  "h-bronze": "copper zinc",
  "h-json-sum": '{"sum": 41}',
  "h-month": "Januar",
  "h-pens": "6",
  "h-sort": "9, 7, 4, 2",
  "h-coins": "1/2",
  "h-vowels": "4",
  "h-fahrenheit": "37",
  "h-days-ago": "Wednesday",
  "h-floor-div": "3.5",
  "h-letters": "8",
  "h-larger": "0.65",
  "h-translate": "Bitte",
  "h-capital": "Sydney",
};

describe("kernel holdout tasks (teacher-written)", () => {
  it("covers every task with distinct ids", () => {
    const ids = KERNEL_HOLDOUT.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(right).sort()).toEqual([...ids].sort());
  });

  for (const task of KERNEL_HOLDOUT) {
    it(`${task.id} accepts the answer and rejects a wrong one`, () => {
      expect(task.correct(right[task.id]!)).toBe(true);
      expect(task.strict(right[task.id]!)).toBe(true);
      expect(task.correct(wrong[task.id]!)).toBe(false);
      expect(task.strict(wrong[task.id]!)).toBe(false);
    });
  }
});
