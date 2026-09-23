// Starting points on the home screen. Each one only begins a sentence in the
// composer; the person finishes it, and routing decides the arms from the
// finished objective exactly as it would for anything typed freely.

export type Starter = {
  id: "build" | "research" | "code" | "analyze" | "create";
  label: string;
  description: string;
  prefix: string;
};

export const STARTERS: Starter[] = [
  {
    id: "build",
    label: "Build",
    description: "Turn an idea into a working page or app",
    prefix: "Build a web app that ",
  },
  {
    id: "research",
    label: "Research",
    description: "Find sources and verify claims",
    prefix: "Research and compare ",
  },
  {
    id: "code",
    label: "Code",
    description: "Fix or extend a GitHub repository",
    prefix: "Fix the bug in https://github.com/",
  },
  {
    id: "analyze",
    label: "Analyze",
    description: "Compute, model and check the numbers",
    prefix: "Calculate ",
  },
  {
    id: "create",
    label: "Create",
    description: "Draft a document, plan or write-up",
    prefix: "Write a document that ",
  },
];
