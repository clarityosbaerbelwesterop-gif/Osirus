import { describe, expect, it } from "vitest";
import {
  buildContractSchema,
  contractProblems,
  slugId,
} from "../src/lib/building/contract";

// Production run 4377a38d failed its build at "Design the deliverable": the
// free model returned userFlows as sentences, and the strict schema rejected
// the whole contract (invalid_type at userFlows[0]). The content was right;
// only the shape was not.

const screen = {
  id: "home",
  name: "Home",
  path: "/",
  purpose: "Show the tasks",
  acceptance: { texts: ["Tasks"], selectors: [] },
};

describe("build contract shapes a free model returns", () => {
  it("accepts flows written as sentences", () => {
    const contract = buildContractSchema.parse({
      product: "Todo app",
      screens: [screen],
      userFlows: ["Add a task", "Mark a task as done"],
    });
    expect(contract.userFlows).toEqual([
      { id: "add-a-task", name: "Add a task", steps: ["Add a task"] },
      {
        id: "mark-a-task-as-done",
        name: "Mark a task as done",
        steps: ["Mark a task as done"],
      },
    ]);
  });

  it("repairs ids, paths, steps, states, devices and component names", () => {
    const contract = buildContractSchema.parse({
      product: "Café website",
      stack: "HTML",
      screens: [
        {
          ...screen,
          id: "Home Page",
          path: "menu",
          components: ["Menu Card"],
          states: ["Loading", "success", "hover"],
        },
      ],
      userFlows: [{ name: "Order coffee", steps: "Pick a drink" }],
      components: ["Menu Card"],
      responsive: ["mobile", "Tablet", "desktop", "watch"],
    });
    const [page] = contract.screens;
    expect(page).toMatchObject({
      id: "home-page",
      path: "/menu",
      components: ["menu-card"],
      states: ["loading", "success"],
    });
    expect(contract.userFlows[0]).toEqual({
      id: "order-coffee",
      name: "Order coffee",
      steps: ["Pick a drink"],
    });
    expect(contract.components[0]).toEqual({
      id: "menu-card",
      name: "Menu Card",
      responsibility: "",
    });
    expect(contract.responsive).toEqual(["phone", "ipad", "desktop"]);
    expect(contract.stack).toBe("static-html");
    expect(contractProblems(contract)).toEqual([]);
  });

  it("still rejects what is missing rather than inventing it", () => {
    expect(() =>
      buildContractSchema.parse({ product: "Todo app", screens: [] }),
    ).toThrow();
    expect(() =>
      buildContractSchema.parse({
        product: "Todo app",
        screens: [{ name: "Home" }],
      }),
    ).toThrow();
    // A screen without an acceptance probe is still a contract problem.
    const contract = buildContractSchema.parse({
      product: "Todo app",
      screens: [{ ...screen, acceptance: undefined }],
    });
    expect(contractProblems(contract)).toEqual([
      "home has no acceptance probe",
    ]);
  });

  it("slugs labels into ids the schema accepts", () => {
    expect(slugId("Über uns")).toBe("uber-uns");
    expect(slugId("404 page")).toBe("x-404-page");
    expect(slugId("!!!")).toBeNull();
    expect(slugId(42)).toBeNull();
  });
});
