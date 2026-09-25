import { architectComposition, composeWorkflow } from "../../arms/compose";
import type { ArmId } from "../../arms/types";
import { topologyOf } from "../../agent/team";
import { validateGraph } from "../../runtime/graph";
import { DEFAULT_ARCHITECTURE } from "../../strategy/runtime";

// The ARCHITECTURE_SEARCH pulse family (M46). Architecture is a Foundry
// candidate that changes the graph Osirus runs; these checks hold the
// machinery to its promises every hour. The default architecture must be
// today's graph exactly -- an accidental change of runtime semantics is the
// failure this family exists to catch -- and every variant must produce a
// valid graph with the shape it claims.

const COMPOSITIONS: ArmId[][] = [
  ["general"],
  ["coding"],
  ["research"],
  ["math_science"],
  ["research", "coding"],
  ["coding", "research"],
  ["thinking", "building"],
  ["math_science", "research", "general"],
];

const shape = (
  composition: ArmId[],
  architecture?: typeof DEFAULT_ARCHITECTURE,
) =>
  composeWorkflow({
    objective: "x",
    composition,
    architecture,
  }).graph.nodes.map((node) => `${node.key}<${node.dependsOn.join("|")}>`);

export type ArchitectureCheck = {
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  check(): { held: boolean; detail: string };
};

export const ARCHITECTURE_CHECKS: ArchitectureCheck[] = [
  {
    level: 1,
    title: "the default architecture is today's graph",
    check() {
      const changed = COMPOSITIONS.filter(
        (composition) =>
          architectComposition(composition, DEFAULT_ARCHITECTURE).join() !==
            composition.join() ||
          shape(composition, DEFAULT_ARCHITECTURE).join() !==
            shape(composition).join(),
      );
      return {
        held: changed.length === 0,
        detail: changed.length
          ? `default changed ${changed.map((c) => c.join("+")).join(", ")}`
          : `${COMPOSITIONS.length} compositions unchanged`,
      };
    },
  },
  {
    level: 2,
    title: "planner → executor puts a planning segment first",
    check() {
      const wrong = COMPOSITIONS.filter((composition) => {
        const out = architectComposition(composition, {
          ...DEFAULT_ARCHITECTURE,
          planning: "planner_executor",
        });
        return (
          out[0] !== "thinking" ||
          out.length > 4 ||
          new Set(out).size !== out.length
        );
      });
      return {
        held: wrong.length === 0,
        detail: wrong.length
          ? `wrong for ${wrong.map((c) => c.join("+")).join(", ")}`
          : "thinking leads every composition, no duplicates",
      };
    },
  },
  {
    level: 3,
    title:
      "memory on demand removes up-front retrieval and keeps a valid graph",
    check() {
      const late = { ...DEFAULT_ARCHITECTURE, memory: "late" as const };
      const failures: string[] = [];
      for (const composition of COMPOSITIONS) {
        const graph = composeWorkflow({
          objective: "x",
          composition,
          architecture: late,
        }).graph;
        try {
          validateGraph(graph);
        } catch (error) {
          failures.push(`${composition.join("+")}: ${String(error)}`);
        }
        if (
          graph.nodes.some((node) => node.input.stageKind === "retrieve_memory")
        )
          failures.push(`${composition.join("+")}: retrieval left`);
        const keys = new Set(graph.nodes.map((node) => node.key));
        if (
          graph.nodes.some((node) => node.dependsOn.some((d) => !keys.has(d)))
        )
          failures.push(`${composition.join("+")}: dangling dependency`);
      }
      return {
        held: failures.length === 0,
        detail: failures.length
          ? failures.join("; ")
          : "valid, no retrieval stage",
      };
    },
  },
  {
    level: 4,
    title: "evidence first moves research to the front, and only research",
    check() {
      const first = { ...DEFAULT_ARCHITECTURE, evidence: "first" as const };
      const wrong = COMPOSITIONS.filter((composition) => {
        const out = architectComposition(composition, first);
        const rest = composition.filter((armId) => armId !== "research");
        return composition.includes("research")
          ? out[0] !== "research" || out.slice(1).join() !== rest.join()
          : out.join() !== composition.join();
      });
      return {
        held: wrong.length === 0,
        detail: wrong.length
          ? `wrong for ${wrong.length}`
          : "research leads when present",
      };
    },
  },
  {
    level: 5,
    title: "the critic maps onto a team topology, and an explicit team wins",
    check() {
      const cases: Array<[Parameters<typeof topologyOf>[0], string]> = [
        [{}, "single"],
        [{ architecture: { critic: "specialist" } }, "solver_critic"],
        [{ architecture: { critic: "adversarial" } }, "solver_adversary"],
        [
          {
            architecture: { critic: "adversarial" },
            team: { topology: "parallel_solvers_judge" },
          },
          "parallel_solvers_judge",
        ],
      ];
      const wrong = cases.filter(
        ([genome, want]) => topologyOf(genome) !== want,
      );
      return {
        held: wrong.length === 0,
        detail: wrong.length
          ? `${wrong.length} wrong mappings`
          : "4 mappings hold",
      };
    },
  },
];
