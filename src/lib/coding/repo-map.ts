import type { CodingWorkspace } from "./workspace";

// What a repository is, read from the repository.
//
// Every field comes from a file that exists: a lockfile decides the package
// manager, a dependency decides a framework, a workflow file is listed because
// it is there. Nothing is guessed from the objective. A map that says "unknown"
// is more useful to the engineering loop than one that is confidently wrong,
// because the loop acts on it -- a wrong package manager runs the wrong
// install and every later failure is noise.

export type PackageManager =
  "npm" | "pnpm" | "yarn" | "bun" | "pip" | "poetry" | "uv" | "cargo" | "go";

export type RepositoryMap = {
  fileCount: number;
  truncated: boolean;
  languages: Array<{ language: string; files: number }>;
  packageManager: PackageManager | null;
  frameworks: string[];
  scripts: Record<string, string>;
  manifests: string[];
  testDirs: string[];
  ciWorkflows: string[];
  configs: string[];
  entryPoints: string[];
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  swift: "Swift",
  sql: "SQL",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  vue: "Vue",
  svelte: "Svelte",
};

const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "Makefile",
  "Gemfile",
  "pom.xml",
  "build.gradle",
];

const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Cargo.lock", "cargo"],
  ["go.sum", "go"],
];

const FRAMEWORK_DEPENDENCIES: Array<[string, string]> = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["vite", "Vite"],
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["@playwright/test", "Playwright"],
  ["typescript", "TypeScript compiler"],
  ["eslint", "ESLint"],
  ["prettier", "Prettier"],
  ["tailwindcss", "Tailwind CSS"],
];

const PYTHON_FRAMEWORKS: Array<[RegExp, string]> = [
  [/\bdjango\b/i, "Django"],
  [/\bflask\b/i, "Flask"],
  [/\bfastapi\b/i, "FastAPI"],
  [/\bpytest\b/i, "pytest"],
  [/\bruff\b/i, "Ruff"],
  [/\bmypy\b/i, "mypy"],
  [/\bnumpy\b/i, "NumPy"],
  [/\bpandas\b/i, "pandas"],
];

const CONFIG_PATTERN =
  /(^|\/)(tsconfig[\w.-]*\.json|\.eslintrc[\w.]*|eslint\.config\.[cm]?[jt]s|\.prettierrc[\w.]*|prettier\.config\.[cm]?js|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|setup\.cfg|tox\.ini|pytest\.ini|ruff\.toml|\.editorconfig|Dockerfile|docker-compose\.ya?ml)$/;

function extension(path: string) {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function dependencyNames(packageJson: unknown) {
  if (!packageJson || typeof packageJson !== "object") return new Set<string>();
  const record = packageJson as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = record[field];
    if (deps && typeof deps === "object")
      for (const name of Object.keys(deps)) names.add(name);
  }
  return names;
}

/**
 * Build the map from a file list and the contents of the few files that
 * matter. Pure, so the same logic is tested without a workspace.
 */
export function mapRepository(
  files: string[],
  contents: Record<string, string>,
  truncated = false,
): RepositoryMap {
  const fileSet = new Set(files);
  const languageCounts = new Map<string, number>();
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[extension(file)];
    if (language)
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }

  let packageManager: PackageManager | null = null;
  for (const [lockfile, manager] of LOCKFILES) {
    if (fileSet.has(lockfile)) {
      packageManager = manager;
      break;
    }
  }

  const frameworks = new Set<string>();
  let scripts: Record<string, string> = {};
  const packageJsonText = contents["package.json"];
  if (packageJsonText) {
    try {
      const parsed = JSON.parse(packageJsonText) as Record<string, unknown>;
      const deps = dependencyNames(parsed);
      for (const [dependency, name] of FRAMEWORK_DEPENDENCIES)
        if (deps.has(dependency)) frameworks.add(name);
      if (parsed.scripts && typeof parsed.scripts === "object") {
        scripts = Object.fromEntries(
          Object.entries(parsed.scripts as Record<string, unknown>)
            .filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            )
            .slice(0, 60),
        );
      }
      if (!packageManager) {
        const declared =
          typeof parsed.packageManager === "string"
            ? parsed.packageManager.split("@")[0]
            : "";
        packageManager =
          declared === "pnpm" || declared === "yarn" || declared === "bun"
            ? declared
            : "npm";
      }
    } catch {
      // A package.json that does not parse is itself a finding; the map says
      // nothing about scripts rather than inventing them.
    }
  }

  const pythonManifest = [
    contents["pyproject.toml"],
    contents["requirements.txt"],
    contents["setup.py"],
  ]
    .filter(Boolean)
    .join("\n");
  if (pythonManifest) {
    for (const [pattern, name] of PYTHON_FRAMEWORKS)
      if (pattern.test(pythonManifest)) frameworks.add(name);
    packageManager ??= "pip";
  }
  if (!packageManager && fileSet.has("Cargo.toml")) packageManager = "cargo";
  if (!packageManager && fileSet.has("go.mod")) packageManager = "go";

  const testDirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    const index = parts.findIndex((part) =>
      /^(tests?|__tests__|spec|e2e)$/.test(part),
    );
    if (index >= 0) testDirs.add(parts.slice(0, index + 1).join("/"));
  }

  return {
    fileCount: files.length,
    truncated,
    languages: [...languageCounts.entries()]
      .map(([language, count]) => ({ language, files: count }))
      .sort((a, b) => b.files - a.files),
    packageManager,
    frameworks: [...frameworks].sort(),
    scripts,
    manifests: MANIFESTS.filter((manifest) => fileSet.has(manifest)),
    testDirs: [...testDirs].sort().slice(0, 20),
    ciWorkflows: files
      .filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))
      .sort(),
    configs: files.filter((file) => CONFIG_PATTERN.test(file)).slice(0, 40),
    entryPoints: files
      .filter((file) =>
        /^(src\/)?(index|main|app|server|cli)\.[cm]?[jt]sx?$|^(src\/)?(main|app|__main__)\.py$|^src\/(main|lib)\.rs$|^main\.go$/.test(
          file,
        ),
      )
      .slice(0, 10),
  };
}

/** The files whose contents the map and command discovery read. */
export const MAP_INPUT_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "Makefile",
];

export async function readMapInputs(
  workspace: CodingWorkspace,
  files: string[],
) {
  const present = new Set(files);
  const contents: Record<string, string> = {};
  const wanted = [
    ...MAP_INPUT_FILES,
    ...files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)),
  ].filter((file) => present.has(file));
  for (const file of wanted.slice(0, 12)) {
    try {
      contents[file] = await workspace.read(file, 100_000);
    } catch {
      // Unreadable (binary, symlink out of the repository): left out.
    }
  }
  return contents;
}

export async function buildRepositoryMap(workspace: CodingWorkspace) {
  const files = await workspace.tree(".", 8, { filesOnly: true });
  const contents = await readMapInputs(workspace, files);
  return {
    map: mapRepository(files, contents, files.length >= 800),
    contents,
    files,
  };
}

/**
 * Facts about the repository stable enough to remember across runs.
 *
 * Only facts read from a file, each with the file as evidence. The memory
 * compiler decides whether they are promoted; this only proposes them.
 */
export function stableRepositoryFacts(
  repository: string | null,
  map: RepositoryMap,
) {
  if (!repository) return [];
  const facts: Array<{ content: string; evidence: string }> = [];
  if (map.packageManager)
    facts.push({
      content: `${repository} uses ${map.packageManager} as its package manager.`,
      evidence: map.manifests.join(", ") || "lockfile",
    });
  if (map.frameworks.length > 0)
    facts.push({
      content: `${repository} depends on ${map.frameworks.join(", ")}.`,
      evidence: map.manifests.join(", "),
    });
  if (map.ciWorkflows.length > 0)
    facts.push({
      content: `${repository} runs CI from ${map.ciWorkflows.join(", ")}.`,
      evidence: map.ciWorkflows.join(", "),
    });
  return facts;
}
