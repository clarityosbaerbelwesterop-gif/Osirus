"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PickerModel } from "./model-picker";

// The models the signed-in person may call (GET /api/models), cached for
// this tab for ten minutes so pickers appear at once, and the remembered
// choice per surface.

const CACHE_KEY = "osirus.models.v4";
const CACHE_MS = 10 * 60 * 1000;

export type ModelsPayload = {
  models: PickerModel[];
  /** The short list shown first (at most about ten). */
  featuredIds?: string[];
  defaultId: string | null;
  freeOnly: boolean;
};

function readCache(): ModelsPayload | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: ModelsPayload };
    if (Date.now() - parsed.at > CACHE_MS) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache(value: ModelsPayload) {
  try {
    window.sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: Date.now(), value }),
    );
  } catch {
    // private mode
  }
}

function dropCache() {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // private mode
  }
}

function remembered(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function forget(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // private mode
  }
}

/**
 * The choice for a fresh list: the current one while it is still listed,
 * else the remembered one, else the default. A remembered model that is no
 * longer listed (plan changed, model gone) is forgotten, so it cannot come
 * back with a stale list and break the next start.
 */
export function pickSelection(input: {
  payload: ModelsPayload;
  current: string | null;
  saved: string | null;
  exclude?: string | null;
}): { selected: string | null; forgetSaved: boolean } {
  const listed = (id: string | null): id is string =>
    Boolean(id) &&
    id !== input.exclude &&
    input.payload.models.some((model) => model.id === id);
  const forgetSaved = Boolean(input.saved) && !listed(input.saved);
  if (listed(input.current)) return { selected: input.current, forgetSaved };
  if (listed(input.saved)) return { selected: input.saved, forgetSaved };
  if (listed(input.payload.defaultId))
    return { selected: input.payload.defaultId, forgetSaved };
  const first = input.payload.models.find(
    (model) => model.id !== input.exclude,
  );
  return { selected: first?.id ?? null, forgetSaved };
}

/**
 * The model list and the chosen model for one surface. `storageKey`
 * remembers the choice in this browser. `reload` reads the list again
 * from the server (after the server refused a choice); `exclude` drops a
 * model the server just refused from the choice until the list is fresh.
 */
export function useGatewayModels(storageKey: string) {
  const [models, setModels] = useState<PickerModel[] | null>(null);
  const [featured, setFeatured] = useState<string[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const exclude = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const apply = (payload: ModelsPayload) => {
      setModels(payload.models);
      setFeatured(payload.featuredIds ?? []);
      setFreeOnly(payload.freeOnly);
      setError(payload.models.length ? null : "Gerade kein Modell erreichbar");
      setSelected((current) => {
        const next = pickSelection({
          payload,
          current,
          saved: remembered(storageKey),
          exclude: exclude.current,
        });
        if (next.forgetSaved) forget(storageKey);
        return next.selected;
      });
    };
    const cached = version === 0 ? readCache() : null;
    if (cached) apply(cached);
    fetch("/api/models", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as ModelsPayload;
        apply(payload);
        writeCache(payload);
      })
      .catch(() => {
        if (controller.signal.aborted || cached) return;
        setModels((current) => current ?? []);
        setError("Modelle nicht erreichbar");
      });
    return () => controller.abort();
  }, [storageKey, version]);

  const choose = useCallback(
    (id: string) => {
      exclude.current = null;
      setSelected(id);
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        // private mode
      }
    },
    [storageKey],
  );

  const reload = useCallback(
    (refused?: string | null) => {
      dropCache();
      if (refused) {
        exclude.current = refused;
        if (remembered(storageKey) === refused) forget(storageKey);
      }
      setVersion((value) => value + 1);
    },
    [storageKey],
  );

  return { models, featured, freeOnly, error, selected, choose, reload };
}
