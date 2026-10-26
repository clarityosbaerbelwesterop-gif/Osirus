import { NVIDIA_TOP_MODELS } from "@/config/recommendations";
import { env, nvidiaKeys } from "@/lib/env";
import { parseModelList } from "@/lib/models/free-registry";
import {
  CATALOG_MODELS,
  NVIDIA_CATALOG_MODELS,
  type CatalogModel,
} from "@/lib/models/catalog";

export type ListedKeyModel = {
  id: string;
  label: string;
  vendor: string;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
};

export type KeyModelList =
  | { availability: "ready"; models: ListedKeyModel[] }
  | { availability: "unknown"; models: []; reason: string };

export function modelsEndpoint(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/$/, "");
  if (path.endsWith("/chat/completions")) {
    url.pathname = `${path.slice(0, -"/chat/completions".length)}/models`;
  } else if (path.endsWith("/v1")) {
    url.pathname = `${path}/models`;
  } else if (!path.endsWith("/models")) {
    return null;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function intersectKeyModels(
  listedIds: readonly string[],
): ListedKeyModel[] {
  const listed = new Set(listedIds);
  return CATALOG_MODELS.filter(
    (model) => model.online && model.chat && listed.has(model.id),
  ).map(toListed);
}

function toListed(model: CatalogModel): ListedKeyModel {
  return {
    id: model.id,
    label: model.id,
    vendor: model.vendor,
    inputPerMillionUsd: model.inputPerMillionUsd,
    outputPerMillionUsd: model.outputPerMillionUsd,
  };
}

/**
 * Models this deployment's key listed, intersected with the public catalog.
 * A failed or unconfigured check returns no models. It does not pretend the
 * public catalog is callable.
 */
export async function listKeyModels(input: {
  baseUrl: string | null | undefined;
  keys: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<KeyModelList> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.baseUrl || input.keys.length === 0) {
    return {
      availability: "unknown",
      models: [],
      reason:
        "Bald verfügbar. UNOROUTER_BASE_URL oder ein API-Key ist nicht gesetzt.",
    };
  }
  const endpoint = modelsEndpoint(input.baseUrl);
  if (!endpoint) {
    return {
      availability: "unknown",
      models: [],
      reason: "Bald verfügbar. UNOROUTER_BASE_URL zeigt nicht auf /v1/models.",
    };
  }
  let lastStatus = 0;
  for (const key of input.keys) {
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const ids = parseModelList(body).map((model) => model.id);
      return { availability: "ready", models: intersectKeyModels(ids) };
    } catch {
      lastStatus = 0;
    }
  }
  return {
    availability: "unknown",
    models: [],
    reason: `Bald verfügbar. Die Key-Liste konnte nicht gelesen werden${lastStatus ? ` (${lastStatus})` : ""}.`,
  };
}

export const DEFAULT_NVIDIA_BASE_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Lists ONLY the curated Top NVIDIA NIM models for user-facing model
 * selectors, backed exclusively by NVIDIA_API_KEY (never UNOROUTER_API_KEY).
 */
export async function listNvidiaTopModels(input?: {
  baseUrl?: string | null;
  keys?: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<KeyModelList> {
  const keys = input?.keys ?? nvidiaKeys();
  const baseUrl =
    input?.baseUrl ??
    env.NVIDIA_BASE_URL ??
    process.env.NVIDIA_BASE_URL ??
    DEFAULT_NVIDIA_BASE_URL;
  const fetchImpl = input?.fetchImpl ?? fetch;

  const configuredTop = (
    env.OSIRUS_NVIDIA_TOP_MODELS ?? process.env.OSIRUS_NVIDIA_TOP_MODELS
  )
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const topSet = new Set<string>(
    configuredTop?.length ? configuredTop : NVIDIA_TOP_MODELS,
  );
  const topCatalog = NVIDIA_CATALOG_MODELS.filter((m) => topSet.has(m.id)).map(
    toListed,
  );

  if (keys.length === 0) {
    return {
      availability: "ready",
      models: topCatalog.length
        ? topCatalog
        : NVIDIA_CATALOG_MODELS.map(toListed),
    };
  }

  const endpoint = modelsEndpoint(baseUrl);
  if (!endpoint) {
    return {
      availability: "ready",
      models: topCatalog.length
        ? topCatalog
        : NVIDIA_CATALOG_MODELS.map(toListed),
    };
  }

  for (const key of keys) {
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const listedIds = new Set(parseModelList(body).map((m) => m.id));
      const matched = NVIDIA_CATALOG_MODELS.filter(
        (m) => topSet.has(m.id) && listedIds.has(m.id),
      ).map(toListed);
      return {
        availability: "ready",
        models: matched.length
          ? matched
          : topCatalog.length
            ? topCatalog
            : NVIDIA_CATALOG_MODELS.map(toListed),
      };
    } catch {
      // Fall through to next key or curated top models.
    }
  }

  return {
    availability: "ready",
    models: topCatalog.length
      ? topCatalog
      : NVIDIA_CATALOG_MODELS.map(toListed),
  };
}
