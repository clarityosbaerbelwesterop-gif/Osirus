import type { CodingWorkspace } from "./workspace";
import type { SoftwareWorldModel } from "./software-world-model";

// Targeted semantic navigation over a SoftwareWorldModel.
//
// These ops prefer the cached model and fixed-string grep over dumping whole
// files into the prompt. They are heuristic: a missing edge means "not found
// yet", not "does not exist".

export type NavOperation =
  | "find_definition"
  | "find_references"
  | "symbol_search"
  | "import_graph"
  | "call_relationships"
  | "test_mapping"
  | "route_mapping"
  | "schema_mapping"
  | "git_blame";

export type NavRequest = {
  op: NavOperation;
  symbol?: string;
  path?: string;
  line?: number;
  limit?: number;
};

export type NavResult = {
  op: NavOperation;
  query: string;
  matches: Array<Record<string, unknown>>;
  truncated: boolean;
  note?: string;
};

function limitOf(input?: number) {
  return Math.min(Math.max(input ?? 20, 1), 50);
}

export function findDefinition(model: SoftwareWorldModel, symbol: string) {
  const exact = model.symbols.filter(
    (entry) => entry.name === symbol || entry.name.endsWith(`.${symbol}`),
  );
  return exact.map((entry) => ({
    symbol: entry.name,
    kind: entry.kind,
    file: entry.module,
    line: entry.line,
  }));
}

export function findReferences(
  model: SoftwareWorldModel,
  workspace: CodingWorkspace,
  symbol: string,
  limit: number,
) {
  const fromModel = model.calls
    .filter((edge) => edge.callee === symbol)
    .map((edge) => ({
      file: edge.file,
      line: edge.line,
      kind: "call",
      context: edge.caller,
    }));
  return fromModel.slice(0, limit);
}

export async function symbolSearch(
  model: SoftwareWorldModel,
  workspace: CodingWorkspace,
  query: string,
  limit: number,
) {
  const lowered = query.toLowerCase();
  const fromModel = model.symbols
    .filter((entry) => entry.name.toLowerCase().includes(lowered))
    .slice(0, limit)
    .map((entry) => ({
      symbol: entry.name,
      kind: entry.kind,
      file: entry.module,
      line: entry.line,
      source: "model",
    }));
  if (fromModel.length >= limit) return { matches: fromModel, truncated: true };
  const grep = await workspace.search(query, ".");
  const extra = grep.slice(0, limit - fromModel.length).map((line) => {
    const [file, lineNo, ...rest] = line.split(":");
    return {
      file,
      line: Number(lineNo),
      text: rest.join(":").slice(0, 200),
      source: "grep",
    };
  });
  return {
    matches: [...fromModel, ...extra],
    truncated: grep.length + fromModel.length > limit,
  };
}

export function importGraph(
  model: SoftwareWorldModel,
  path?: string,
  limit = 30,
) {
  const edges = path
    ? model.imports.filter(
        (edge) => edge.from === path || edge.to.includes(path),
      )
    : model.imports;
  return edges.slice(0, limit).map((edge) => ({
    from: edge.from,
    to: edge.to,
    spec: edge.spec,
  }));
}

export function callRelationships(
  model: SoftwareWorldModel,
  symbol?: string,
  limit = 30,
) {
  const edges = symbol
    ? model.calls.filter(
        (edge) => edge.callee === symbol || edge.caller.includes(symbol),
      )
    : model.calls;
  return edges.slice(0, limit).map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    file: edge.file,
    line: edge.line,
  }));
}

export function testMapping(
  model: SoftwareWorldModel,
  symbolOrPath?: string,
  limit = 20,
) {
  const mappings = symbolOrPath
    ? model.testMappings.filter(
        (mapping) =>
          mapping.testFile.includes(symbolOrPath) ||
          mapping.targets.some((target) => target.includes(symbolOrPath)) ||
          mapping.symbols.some((name) => name.includes(symbolOrPath)),
      )
    : model.testMappings;
  return mappings.slice(0, limit).map((mapping) => ({
    testFile: mapping.testFile,
    targets: mapping.targets,
    symbols: mapping.symbols,
  }));
}

export function routeMapping(model: SoftwareWorldModel, limit = 30) {
  return model.routes.slice(0, limit).map((route) => ({
    method: route.method,
    path: route.path,
    handler: route.handler,
    file: route.file,
  }));
}

export function schemaMapping(model: SoftwareWorldModel, limit = 30) {
  const schemaModules = model.modules.filter(
    (module) => module.kind === "schema",
  );
  const db = model.dbAccess.slice(0, limit);
  return {
    schemaFiles: schemaModules.slice(0, limit).map((module) => module.path),
    dbAccess: db.map((point) => ({
      kind: point.kind,
      file: point.file,
      line: point.line,
      detail: point.detail,
    })),
  };
}

export async function gitBlame(
  workspace: CodingWorkspace,
  path: string,
  line?: number,
) {
  const args = line
    ? ["blame", "-L", `${line},${line}`, "--", path]
    : ["blame", "--", path];
  const record = await workspace.exec("git", args, {
    record: false,
    timeoutMs: 30_000,
  });
  const lines = record.stdout.split("\n").filter(Boolean).slice(0, 20);
  return {
    exitCode: record.exitCode,
    lines: lines.map((entry) => entry.slice(0, 240)),
  };
}

export async function runNavigation(
  model: SoftwareWorldModel,
  workspace: CodingWorkspace,
  request: NavRequest,
): Promise<NavResult> {
  const limit = limitOf(request.limit);
  const symbol = request.symbol?.trim() ?? "";
  const path = request.path?.trim() ?? "";

  switch (request.op) {
    case "find_definition": {
      if (!symbol)
        return {
          op: request.op,
          query: symbol,
          matches: [],
          truncated: false,
          note: "symbol is required",
        };
      const matches = findDefinition(model, symbol);
      return { op: request.op, query: symbol, matches, truncated: false };
    }
    case "find_references": {
      if (!symbol)
        return {
          op: request.op,
          query: symbol,
          matches: [],
          truncated: false,
          note: "symbol is required",
        };
      const modelRefs = findReferences(model, workspace, symbol, limit);
      const grep = await workspace.search(symbol, path || ".");
      const grepRefs = grep.slice(0, limit).map((line) => {
        const [file, lineNo, ...rest] = line.split(":");
        return {
          file,
          line: Number(lineNo),
          text: rest.join(":").slice(0, 200),
        };
      });
      const combined = [...modelRefs, ...grepRefs].slice(0, limit);
      return {
        op: request.op,
        query: symbol,
        matches: combined,
        truncated: grep.length + modelRefs.length > limit,
      };
    }
    case "symbol_search": {
      if (!symbol)
        return {
          op: request.op,
          query: symbol,
          matches: [],
          truncated: false,
          note: "symbol is required",
        };
      const { matches, truncated } = await symbolSearch(
        model,
        workspace,
        symbol,
        limit,
      );
      return { op: request.op, query: symbol, matches, truncated };
    }
    case "import_graph": {
      const matches = importGraph(model, path || undefined, limit);
      return {
        op: request.op,
        query: path || "*",
        matches,
        truncated: model.imports.length > limit,
      };
    }
    case "call_relationships": {
      const matches = callRelationships(model, symbol || undefined, limit);
      return {
        op: request.op,
        query: symbol || "*",
        matches,
        truncated: model.calls.length > limit,
      };
    }
    case "test_mapping": {
      const matches = testMapping(model, symbol || path || undefined, limit);
      return {
        op: request.op,
        query: symbol || path || "*",
        matches,
        truncated: false,
      };
    }
    case "route_mapping": {
      const matches = routeMapping(model, limit);
      return {
        op: request.op,
        query: "*",
        matches,
        truncated: model.routes.length > limit,
      };
    }
    case "schema_mapping": {
      const mapping = schemaMapping(model, limit);
      return {
        op: request.op,
        query: "*",
        matches: [mapping],
        truncated: false,
      };
    }
    case "git_blame": {
      if (!path)
        return {
          op: request.op,
          query: path,
          matches: [],
          truncated: false,
          note: "path is required",
        };
      const blame = await gitBlame(workspace, path, request.line);
      return {
        op: request.op,
        query: path,
        matches: blame.lines.map((line) => ({ line })),
        truncated: false,
        note: blame.exitCode === 0 ? undefined : "git blame failed",
      };
    }
    default:
      return {
        op: request.op,
        query: "",
        matches: [],
        truncated: false,
        note: "unknown operation",
      };
  }
}

export const NAV_OPERATIONS: NavOperation[] = [
  "find_definition",
  "find_references",
  "symbol_search",
  "import_graph",
  "call_relationships",
  "test_mapping",
  "route_mapping",
  "schema_mapping",
  "git_blame",
];
