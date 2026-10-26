"use client";

import { useCallback, useEffect, useState } from "react";
import type { PickerModel } from "./model-picker";

// The models the signed-in person may call (GET /api/models), cached for
// this tab for ten minutes so pickers appear at once, and the remembered
// choice per surface.

const CACHE_KEY = "osirus.models.v2";
const CACHE_MS = 10 * 60 * 1000;

export type ModelsPayload = {
  models: PickerModel[];
  defaultRef: string | null;
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

function remembered(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The model list and the chosen model for one surface. `storageKey`
 * remembers the choice in this browser.
 */
export function useGatewayModels(storageKey: string) {
  const [models, setModels] = useState<PickerModel[] | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const apply = (payload: ModelsPayload) => {
      setModels(payload.models);
      setFreeOnly(payload.freeOnly);
      setError(payload.models.length ? null : "Kein Modell-Key hinterlegt");
      setSelected((current) => {
        if (current && payload.models.some((model) => model.ref === current))
          return current;
        const saved = remembered(storageKey);
        if (saved && payload.models.some((model) => model.ref === saved))
          return saved;
        return payload.defaultRef;
      });
    };
    const cached = readCache();
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
        setModels([]);
        setError("Modelle nicht erreichbar");
      });
    return () => controller.abort();
  }, [storageKey]);

  const choose = useCallback(
    (ref: string) => {
      setSelected(ref);
      try {
        window.localStorage.setItem(storageKey, ref);
      } catch {
        // private mode
      }
    },
    [storageKey],
  );

  return { models, freeOnly, error, selected, choose };
}
