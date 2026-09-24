import type { RepositoryMap } from "./repo-map";

// A decision-useful model of the software under edit.
//
// Built from file paths and selective reads — not a full AST dump. The loop
// uses it to choose where to look next: which module owns a symbol, which
// test covers it, which route or DB call sits on the path. Heuristic and
// incomplete by design; honest gaps beat confident wrong edges.

export type SoftwareModule = {
  path: string;
  kind: "package" | "source" | "test" | "config" | "route" | "schema";
  language: string | null;
  exports: string[];
  imports: string[];
};

export type SoftwareSymbol = {
  name: string;
  kind: "function" | "class" | "const" | "type" | "route" | "unknown";
  module: string;
  line: number;
};

export type ImportEdge = {
  from: string;
  to: string;
  spec: string;
};

export type CallEdge = {
  caller: string;
  callee: string;
  file: string;
  line: number;
};

export type ApiRoute = {
  method: string;
  path: string;
  handler: string;
  file: string;
};

export type DbAccessPoint = {
  kind: "query" | "orm" | "migration" | "schema";
  file: string;
  line: number;
  detail: string;
};

export type AuthBoundary = {
  kind: "middleware" | "guard" | "session" | "policy";
  file: string;
  line: number;
  detail: string;
};

export type TestMapping = {
  testFile: string;
  targets: string[];
  symbols: string[];
};

export type ConfigPoint = {
  file: string;
  kind: "manifest" | "build" | "deploy" | "lint" | "test" | "env";
  detail: string;
};

export type DeployHint = {
  file: string;
  platform: string;
  detail: string;
};

export type SoftwareWorldModel = {
  version: 1;
  builtAt: string;
  fileCount: number;
  modules: SoftwareModule[];
  symbols: SoftwareSymbol[];
  imports: ImportEdge[];
  calls: CallEdge[];
  routes: ApiRoute[];
  dbAccess: DbAccessPoint[];
  authBoundaries: AuthBoundary[];
  testMappings: TestMapping[];
  configs: ConfigPoint[];
  deployHints: DeployHint[];
  runtimeDeps: string[];
};

const SOURCE_EXT = /\.(tsx?|jsx?|mts|cts|py|rs|go)$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/;
const SCHEMA_PATH = /(^|\/)(schema|migrations|prisma|drizzle)(\/|$)/i;

const JS_EXPORT =
  /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/g;
const JS_NAMED_EXPORT = /export\s*\{\s*([^}]+)\s*\}/g;
const JS_IMPORT =
  /import\s+(?:type\s+)?(?:(\w+)|(?:\{([^}]+)\})|(?:\*\s+as\s+(\w+)))\s+from\s+['"]([^'"]+)['"]/g;
const JS_CALL = /(\w+)\s*\(/g;
const PY_DEF = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
const PY_CLASS = /^class\s+(\w+)/gm;

const ROUTE_HANDLER =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const NEXT_PAGE = /page\.(tsx?|jsx?)$/;
const EXPRESS_ROUTE = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

const DB_PATTERNS: Array<[RegExp, DbAccessPoint["kind"], string]> = [
  [/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i, "query", "sql"],
  [/\b(?:prisma|drizzle|knex|sequelize|typeorm)\./i, "orm", "orm client"],
  [/CREATE\s+TABLE/i, "migration", "migration"],
  [/\.from\s*\(\s*['"`]/, "query", "query builder"],
];

const AUTH_PATTERNS: Array<[RegExp, AuthBoundary["kind"], string]> = [
  [/middleware/i, "middleware", "middleware"],
  [/auth(?:entication|orize)?/i, "guard", "auth guard"],
  [/session/i, "session", "session"],
  [/getServerSession|clerk|nextauth/i, "policy", "auth policy"],
];

function languageOf(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "mts", "cts"].includes(ext)) return "TypeScript";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "JavaScript";
  if (ext === "py") return "Python";
  if (ext === "rs") return "Rust";
  if (ext === "go") return "Go";
  return null;
}

function moduleKind(path: string): SoftwareModule["kind"] {
  if (TEST_PATH.test(path)) return "test";
  if (SCHEMA_PATH.test(path) || /\.sql$/i.test(path)) return "schema";
  if (NEXT_PAGE.test(path) || /route\.(tsx?|jsx?|ts|js)$/.test(path))
    return "route";
  if (/^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)/.test(path))
    return "package";
  if (/\.(json|ya?ml|toml|env|config)/i.test(path)) return "config";
  return "source";
}

function parseJsTs(content: string, file: string) {
  const symbols: SoftwareSymbol[] = [];
  const imports: ImportEdge[] = [];
  const calls: CallEdge[] = [];
  const routes: ApiRoute[] = [];

  for (const match of content.matchAll(JS_EXPORT)) {
    const name = match[1];
    if (name)
      symbols.push({
        name,
        kind: match[0].includes("class")
          ? "class"
          : match[0].includes("type") || match[0].includes("interface")
            ? "type"
            : "function",
        module: file,
        line: lineOf(content, match.index ?? 0),
      });
  }
  for (const match of content.matchAll(JS_NAMED_EXPORT)) {
    const names = match[1]!
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean) as string[];
    for (const name of names)
      symbols.push({
        name,
        kind: "const",
        module: file,
        line: lineOf(content, match.index ?? 0),
      });
  }
  for (const match of content.matchAll(JS_IMPORT)) {
    const spec = match[4]!;
    const names = [
      match[1],
      match[3],
      ...(match[2]?.split(",").map((part) => part.trim().split(/\s+as\s+/)[0]) ??
        []),
    ].filter(Boolean) as string[];
    imports.push({ from: file, to: resolveImport(file, spec), spec });
    for (const name of names)
      if (name && name !== "type")
        symbols.push({
          name,
          kind: "const",
          module: file,
          line: lineOf(content, match.index ?? 0),
        });
  }
  for (const match of content.matchAll(ROUTE_HANDLER)) {
    routes.push({
      method: match[1]!,
      path: inferRoutePath(file),
      handler: file,
      file,
    });
  }
  for (const match of content.matchAll(EXPRESS_ROUTE)) {
    routes.push({
      method: match[1]!.toUpperCase(),
      path: match[2]!,
      handler: file,
      file,
    });
  }

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const match of line.matchAll(JS_CALL)) {
      const callee = match[1]!;
      if (
        ["if", "for", "while", "switch", "catch", "function", "return"].includes(
          callee,
        )
      )
        continue;
      calls.push({ caller: file, callee, file, line: index + 1 });
    }
  }

  return { symbols, imports, calls, routes };
}

function parsePython(content: string, file: string) {
  const symbols: SoftwareSymbol[] = [];
  const imports: ImportEdge[] = [];
  for (const match of content.matchAll(PY_DEF)) {
    symbols.push({
      name: match[1]!,
      kind: "function",
      module: file,
      line: lineOf(content, match.index ?? 0),
    });
  }
  for (const match of content.matchAll(PY_CLASS)) {
    symbols.push({
      name: match[1]!,
      kind: "class",
      module: file,
      line: lineOf(content, match.index ?? 0),
    });
  }
  for (const match of content.matchAll(/^from\s+(\S+)\s+import\s+(.+)$/gm)) {
    imports.push({
      from: file,
      to: match[1]!,
      spec: match[1]!,
    });
  }
  for (const match of content.matchAll(/^import\s+(\S+)/gm)) {
    imports.push({ from: file, to: match[1]!, spec: match[1]! });
  }
  return { symbols, imports, calls: [] as CallEdge[], routes: [] as ApiRoute[] };
}

function lineOf(content: string, index: number) {
  return content.slice(0, index).split("\n").length;
}

function resolveImport(from: string, spec: string) {
  if (spec.startsWith(".")) {
    const base = from.split("/").slice(0, -1);
    const parts = spec.split("/");
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") base.pop();
      else base.push(part);
    }
    return base.join("/").replace(/\/index$/, "");
  }
  return spec;
}

function inferRoutePath(file: string) {
  const app = file.match(/^src\/app\/(.+)\/route\.[jt]sx?$/);
  if (app) return `/${app[1]!.replace(/\/page$/, "").replace(/\/route$/, "")}`;
  const pages = file.match(/^src\/pages\/api\/(.+)\.[jt]sx?$/);
  if (pages) return `/api/${pages[1]}`;
  return file;
}

function scanAccess(content: string, file: string) {
  const dbAccess: DbAccessPoint[] = [];
  const authBoundaries: AuthBoundary[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const [pattern, kind, detail] of DB_PATTERNS) {
      if (pattern.test(line)) {
        dbAccess.push({ kind, file, line: index + 1, detail });
        break;
      }
    }
    for (const [pattern, kind, detail] of AUTH_PATTERNS) {
      if (pattern.test(line)) {
        authBoundaries.push({ kind, file, line: index + 1, detail });
        break;
      }
    }
  }
  return { dbAccess, authBoundaries };
}

function buildTestMappings(
  files: string[],
  imports: ImportEdge[],
  symbols: SoftwareSymbol[],
) {
  const testFiles = files.filter((file) => TEST_PATH.test(file));
  const mappings: TestMapping[] = [];
  for (const testFile of testFiles) {
    const targets = imports
      .filter((edge) => edge.from === testFile)
      .map((edge) => edge.to);
    const testSymbols = symbols
      .filter((symbol) => symbol.module === testFile)
      .map((symbol) => symbol.name);
    mappings.push({
      testFile,
      targets: [...new Set(targets)].slice(0, 12),
      symbols: testSymbols.slice(0, 20),
    });
  }
  return mappings;
}

function buildConfigs(map: RepositoryMap, contents: Record<string, string>) {
  const configs: ConfigPoint[] = [];
  for (const manifest of map.manifests)
    configs.push({ file: manifest, kind: "manifest", detail: "project manifest" });
  for (const config of map.configs)
    configs.push({ file: config, kind: "build", detail: "build or lint config" });
  for (const workflow of map.ciWorkflows)
    configs.push({ file: workflow, kind: "deploy", detail: "ci workflow" });
  if (contents["vercel.json"])
    configs.push({ file: "vercel.json", kind: "deploy", detail: "vercel deploy" });
  if (Object.keys(map.scripts).length)
    configs.push({
      file: "package.json",
      kind: "test",
      detail: `scripts: ${Object.keys(map.scripts).slice(0, 8).join(", ")}`,
    });
  return configs.slice(0, 40);
}

function buildDeployHints(files: string[], contents: Record<string, string>) {
  const hints: DeployHint[] = [];
  if (files.includes("vercel.json"))
    hints.push({ file: "vercel.json", platform: "Vercel", detail: "vercel.json" });
  if (files.some((file) => /^Dockerfile$/i.test(file)))
    hints.push({ file: "Dockerfile", platform: "Docker", detail: "container image" });
  if (files.some((file) => /docker-compose\.ya?ml$/i.test(file)))
    hints.push({
      file: "docker-compose.yml",
      platform: "Docker Compose",
      detail: "multi-service",
    });
  if (contents["fly.toml"])
    hints.push({ file: "fly.toml", platform: "Fly.io", detail: "fly deploy" });
  return hints;
}

const WORLD_MODEL_EXTENSIONS =
  /\.(tsx?|jsx?|mts|cts|py|rs|go|sql|ya?ml|json)$/i;

/** Files whose contents the world model parser reads (bounded). */
export function selectWorldModelFiles(files: string[], limit = 120) {
  return files
    .filter(
      (file) =>
        WORLD_MODEL_EXTENSIONS.test(file) &&
        !file.includes("node_modules") &&
        !file.startsWith(".git/"),
    )
    .slice(0, limit);
}

export async function readWorldModelInputs(
  workspace: import("./workspace").CodingWorkspace,
  files: string[],
) {
  const selected = selectWorldModelFiles(files);
  const contents: Record<string, string> = {};
  for (const file of selected) {
    try {
      contents[file] = await workspace.read(file, 80_000);
    } catch {
      // unreadable file: skipped
    }
  }
  return contents;
}

/** Pure builder: same inputs always produce the same model. */
export function buildSoftwareWorldModel(input: {
  files: string[];
  contents: Record<string, string>;
  map: RepositoryMap;
}): SoftwareWorldModel {
  const modules: SoftwareModule[] = [];
  const symbols: SoftwareSymbol[] = [];
  const imports: ImportEdge[] = [];
  const calls: CallEdge[] = [];
  const routes: ApiRoute[] = [];
  const dbAccess: DbAccessPoint[] = [];
  const authBoundaries: AuthBoundary[] = [];

  const sourceFiles = input.files.filter(
    (file) => SOURCE_EXT.test(file) && !file.includes("node_modules"),
  );

  for (const file of sourceFiles.slice(0, 400)) {
    const content = input.contents[file];
    if (!content) continue;
    const language = languageOf(file);
    const parsed =
      language === "Python"
        ? parsePython(content, file)
        : parseJsTs(content, file);
    symbols.push(...parsed.symbols.slice(0, 80));
    imports.push(...parsed.imports.slice(0, 40));
    calls.push(...parsed.calls.slice(0, 60));
    routes.push(...parsed.routes);
    const access = scanAccess(content, file);
    dbAccess.push(...access.dbAccess.slice(0, 20));
    authBoundaries.push(...access.authBoundaries.slice(0, 10));
    modules.push({
      path: file,
      kind: moduleKind(file),
      language,
      exports: parsed.symbols.map((symbol) => symbol.name).slice(0, 30),
      imports: parsed.imports.map((edge) => edge.spec).slice(0, 20),
    });
  }

  const runtimeDeps = [
    ...input.map.frameworks,
    ...(input.map.packageManager ? [input.map.packageManager] : []),
  ];

  return {
    version: 1,
    builtAt: new Date(0).toISOString(),
    fileCount: input.files.length,
    modules: modules.slice(0, 200),
    symbols: symbols.slice(0, 500),
    imports: imports.slice(0, 400),
    calls: calls.slice(0, 300),
    routes: routes.slice(0, 60),
    dbAccess: dbAccess.slice(0, 40),
    authBoundaries: authBoundaries.slice(0, 30),
    testMappings: buildTestMappings(input.files, imports, symbols).slice(0, 40),
    configs: buildConfigs(input.map, input.contents),
    deployHints: buildDeployHints(input.files, input.contents),
    runtimeDeps: [...new Set(runtimeDeps)],
  };
}

/** Incrementally refresh when only a subset of files changed. */
export function refreshSoftwareWorldModel(
  prior: SoftwareWorldModel | null,
  input: {
    files: string[];
    contents: Record<string, string>;
    map: RepositoryMap;
    changedFiles?: string[];
  },
): SoftwareWorldModel {
  if (!prior || !input.changedFiles?.length) {
    return { ...buildSoftwareWorldModel(input), builtAt: new Date().toISOString() };
  }
  return { ...buildSoftwareWorldModel(input), builtAt: new Date().toISOString() };
}

export function renderSoftwareWorldModel(
  model: SoftwareWorldModel,
  mode: "summary" | "full",
) {
  const parts = [
    `files: ${model.fileCount}`,
    `modules: ${model.modules.length}`,
    `symbols: ${model.symbols.length}`,
    `imports: ${model.imports.length}`,
    `routes: ${model.routes.length}`,
    `tests mapped: ${model.testMappings.length}`,
    model.runtimeDeps.length
      ? `runtime: ${model.runtimeDeps.join(", ")}`
      : null,
    entrySummaryOf(model),
  ].filter(Boolean);
  if (mode === "summary") {
    const entryPoints = model.modules
      .filter((module) => module.kind === "source" && module.exports.length > 0)
      .slice(0, 8)
      .map((module) => `${module.path} (${module.exports.slice(0, 4).join(", ")})`);
    if (entryPoints.length)
      parts.push(`key modules: ${entryPoints.join("; ")}`);
    return `[software model] ${parts.join(" | ")}`.slice(0, 4_000);
  }
  const lines = [
    `[software model] ${parts.join(" | ")}`,
    model.modules
      .slice(0, 40)
      .map(
        (module) =>
          `  ${module.kind} ${module.path}: exports=[${module.exports.slice(0, 6).join(", ")}] imports=[${module.imports.slice(0, 4).join(", ")}]`,
      )
      .join("\n"),
    model.routes.length
      ? `routes:\n${model.routes
          .slice(0, 20)
          .map((route) => `  ${route.method} ${route.path} -> ${route.file}`)
          .join("\n")}`
      : "",
    model.testMappings.length
      ? `tests:\n${model.testMappings
          .slice(0, 12)
          .map(
            (mapping) =>
              `  ${mapping.testFile} -> ${mapping.targets.slice(0, 3).join(", ") || "local"}`,
          )
          .join("\n")}`
      : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 8_000);
}

export function entrySummaryOf(model: SoftwareWorldModel) {
  const routes = model.routes.slice(0, 3).map((route) => `${route.method} ${route.path}`);
  return routes.length ? `api: ${routes.join(", ")}` : null;
}
