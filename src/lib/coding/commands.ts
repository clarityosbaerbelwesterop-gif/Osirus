import type { RepositoryMap } from "./repo-map";

// Which commands this repository uses to check itself.
//
// Discovered, never invented. A command appears here only because a manifest,
// a Makefile or a CI workflow in the repository names it. A repository with no
// test script has no test command, and the verifier then says the tests were
// not run -- which is true -- instead of the loop running `npm test` against a
// project that never defined it and reading the failure as a broken change.
//
// Every command is an argument array. None of them passes through a shell, so
// nothing a repository or a model writes into a script name becomes syntax.

export type CommandPhase =
  "install" | "format" | "lint" | "typecheck" | "test" | "build" | "e2e";

export type DiscoveredCommand = {
  id: string;
  phase: CommandPhase;
  cmd: string;
  args: string[];
  /** Where it came from, e.g. "package.json#scripts.test". */
  source: string;
  /** Whether it needs network access to a package registry. */
  network: boolean;
};

export const PHASE_ORDER: CommandPhase[] = [
  "install",
  "format",
  "lint",
  "typecheck",
  "test",
  "build",
  "e2e",
];

/** Script names mapped to phases. A script that writes files is not a check. */
function phaseOfScript(name: string, body: string): CommandPhase | null {
  const lower = name.toLowerCase();
  if (/^(format:check|fmt:check|check:format|prettier:check)$/.test(lower))
    return "format";
  if (/^format$|^fmt$/.test(lower) && /--check|--list-different/.test(body))
    return "format";
  if (/^lint$|^lint:(check|all)$|^eslint$/.test(lower)) return "lint";
  if (/^(typecheck|type-check|types|check:types|tsc)$/.test(lower))
    return "typecheck";
  if (/^(test:e2e|e2e|test:browser|playwright)$/.test(lower)) return "e2e";
  if (/^(test|test:unit|unit|test:ci)$/.test(lower)) return "test";
  if (/^build$/.test(lower)) return "build";
  return null;
}

const SHELL_SYNTAX = /[|&;<>$`()*?{}[\]\\'"!#~]/;

/**
 * Split a CI `run:` line into an argument array, or refuse.
 *
 * Only a plain command with no shell syntax at all is accepted. `npm ci && npm
 * test` is two commands joined by a shell; rather than parse shell, the line
 * is skipped -- the manifest scripts usually carry the same commands anyway.
 */
export function splitPlainCommand(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200 || SHELL_SYNTAX.test(trimmed))
    return null;
  const parts = trimmed.split(/\s+/);
  return parts.length > 0 ? parts : null;
}

function workflowRunLines(yaml: string) {
  const lines: string[] = [];
  for (const match of yaml.matchAll(/^\s*-?\s*run:\s*([^|>\n][^\n]*)$/gm)) {
    lines.push(match[1]!.trim());
  }
  return lines;
}

function makeTargets(makefile: string) {
  const targets = new Set<string>();
  for (const match of makefile.matchAll(/^([A-Za-z][\w-]*):(?!=)/gm)) {
    targets.add(match[1]!);
  }
  return targets;
}

function hasDependencies(packageJson: string) {
  try {
    const parsed = JSON.parse(packageJson) as Record<string, unknown>;
    return ["dependencies", "devDependencies"].some((field) => {
      const deps = parsed[field];
      return Boolean(
        deps && typeof deps === "object" && Object.keys(deps).length,
      );
    });
  } catch {
    return false;
  }
}

function runScript(manager: string, script: string): [string, string[]] {
  if (manager === "yarn") return ["yarn", ["run", script]];
  if (manager === "pnpm") return ["pnpm", ["run", script]];
  if (manager === "bun") return ["bun", ["run", script]];
  return ["npm", ["run", script]];
}

export function discoverCommands(
  map: RepositoryMap,
  contents: Record<string, string>,
  files: string[],
): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  const add = (command: Omit<DiscoveredCommand, "id">) => {
    if (commands.some((existing) => existing.phase === command.phase)) return;
    commands.push({ ...command, id: `${command.phase}` });
  };
  const fileSet = new Set(files);

  // JavaScript / TypeScript: install from the lockfile, checks from scripts.
  if (contents["package.json"] !== undefined) {
    const manager = map.packageManager ?? "npm";
    if (fileSet.has("package-lock.json"))
      add({
        phase: "install",
        cmd: "npm",
        args: ["ci", "--no-audit", "--no-fund"],
        source: "package-lock.json",
        network: true,
      });
    else if (fileSet.has("pnpm-lock.yaml"))
      add({
        phase: "install",
        cmd: "pnpm",
        args: ["install", "--frozen-lockfile"],
        source: "pnpm-lock.yaml",
        network: true,
      });
    else if (fileSet.has("yarn.lock"))
      add({
        phase: "install",
        cmd: "yarn",
        args: ["install", "--frozen-lockfile"],
        source: "yarn.lock",
        network: true,
      });
    else if (hasDependencies(contents["package.json"]))
      add({
        phase: "install",
        cmd: "npm",
        args: ["install", "--no-audit", "--no-fund"],
        source: "package.json (no lockfile)",
        network: true,
      });

    for (const phase of PHASE_ORDER) {
      for (const [name, body] of Object.entries(map.scripts)) {
        if (phaseOfScript(name, body) !== phase) continue;
        const [cmd, args] = runScript(manager, name);
        add({
          phase,
          cmd,
          args,
          source: `package.json#scripts.${name}`,
          network: false,
        });
        break;
      }
    }
  }

  // Python.
  const python = [
    contents["pyproject.toml"],
    contents["requirements.txt"],
    contents["setup.py"],
  ]
    .filter(Boolean)
    .join("\n");
  if (python) {
    if (fileSet.has("requirements.txt"))
      add({
        phase: "install",
        cmd: "python3",
        args: ["-m", "pip", "install", "-q", "-r", "requirements.txt"],
        source: "requirements.txt",
        network: true,
      });
    else if (fileSet.has("pyproject.toml"))
      add({
        phase: "install",
        cmd: "python3",
        args: ["-m", "pip", "install", "-q", "-e", "."],
        source: "pyproject.toml",
        network: true,
      });
    if (/\bruff\b/i.test(python))
      add({
        phase: "lint",
        cmd: "python3",
        args: ["-m", "ruff", "check", "."],
        source: "ruff in Python manifest",
        network: false,
      });
    if (/\bmypy\b/i.test(python))
      add({
        phase: "typecheck",
        cmd: "python3",
        args: ["-m", "mypy", "."],
        source: "mypy in Python manifest",
        network: false,
      });
    if (/\bpytest\b/i.test(python) || fileSet.has("pytest.ini"))
      add({
        phase: "test",
        cmd: "python3",
        args: ["-m", "pytest", "-q"],
        source: "pytest in Python manifest",
        network: false,
      });
  }

  // Rust.
  if (fileSet.has("Cargo.toml")) {
    add({
      phase: "format",
      cmd: "cargo",
      args: ["fmt", "--check"],
      source: "Cargo.toml",
      network: false,
    });
    add({
      phase: "test",
      cmd: "cargo",
      args: ["test"],
      source: "Cargo.toml",
      network: true,
    });
    add({
      phase: "build",
      cmd: "cargo",
      args: ["build"],
      source: "Cargo.toml",
      network: true,
    });
  }

  // Go.
  if (fileSet.has("go.mod")) {
    add({
      phase: "test",
      cmd: "go",
      args: ["test", "./..."],
      source: "go.mod",
      network: true,
    });
    add({
      phase: "build",
      cmd: "go",
      args: ["build", "./..."],
      source: "go.mod",
      network: true,
    });
  }

  // Makefile targets fill phases the manifests left empty.
  if (contents.Makefile) {
    const targets = makeTargets(contents.Makefile);
    const byPhase: Array<[CommandPhase, string[]]> = [
      ["format", ["format-check", "fmt-check"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check"]],
      ["test", ["test", "check"]],
      ["build", ["build"]],
    ];
    for (const [phase, names] of byPhase) {
      const target = names.find((name) => targets.has(name));
      if (target)
        add({
          phase,
          cmd: "make",
          args: [target],
          source: `Makefile#${target}`,
          network: false,
        });
    }
  }

  // CI workflows: only plain commands, only for phases still empty.
  for (const [file, text] of Object.entries(contents)) {
    if (!/^\.github\/workflows\//.test(file)) continue;
    for (const line of workflowRunLines(text)) {
      const parts = splitPlainCommand(line);
      if (!parts) continue;
      const joined = parts.join(" ");
      const phase: CommandPhase | null = /\b(test|pytest)\b/.test(joined)
        ? "test"
        : /\bbuild\b/.test(joined)
          ? "build"
          : /\blint\b/.test(joined)
            ? "lint"
            : null;
      if (phase)
        add({
          phase,
          cmd: parts[0]!,
          args: parts.slice(1),
          source: `${file}: ${joined}`,
          network: false,
        });
    }
  }

  return commands.sort(
    (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
  );
}

/** The phases that decide whether a change works, in the order to run them. */
export function checkSequence(commands: DiscoveredCommand[]) {
  return commands.filter((command) =>
    ["format", "lint", "typecheck", "test", "build"].includes(command.phase),
  );
}
