"use client";

import { Brain, Check, ChevronDown, Search, Sparkles } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cx } from "../ui/cx";

/** A model as the browser sees it: an opaque id, a name and a class. */
export type PickerModel = {
  id: string;
  name: string;
  tier: "top" | "balanced" | "fast";
  free: boolean;
  reasoning: boolean;
  contextLength: number | null;
};

type Group = { label: string; models: PickerModel[] };

const TIER_LABELS: Array<[PickerModel["tier"], string]> = [
  ["top", "Top"],
  ["balanced", "Ausgewogen"],
  ["fast", "Schnell"],
];

export function groupModels(
  models: readonly PickerModel[],
  query: string,
): Group[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? models.filter((model) => model.name.toLowerCase().includes(needle))
    : models;
  if (needle)
    return matches.length ? [{ label: "Treffer", models: [...matches] }] : [];
  return TIER_LABELS.map(([tier, label]) => ({
    label,
    models: matches.filter((model) => model.tier === tier),
  })).filter((group) => group.models.length > 0);
}

function contextLabel(tokens: number | null) {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export function ModelPicker(props: {
  models: readonly PickerModel[] | null;
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  freeOnly?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const selected =
    props.models?.find((model) => model.id === props.value) ?? null;
  const groups = useMemo(
    () => groupModels(props.models ?? [], query),
    [props.models, query],
  );
  const flat = useMemo(() => groups.flatMap((group) => group.models), [groups]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    searchRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const choose = (id: string) => {
    props.onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[cursor];
      if (target) choose(target.id);
    }
  };

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listId}-${cursor}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, listId, open]);

  const loading = props.models === null;
  const empty = !loading && (props.models?.length ?? 0) === 0;
  let index = -1;

  return (
    <div className="mp" ref={rootRef} onKeyDown={onKey}>
      <button
        type="button"
        className={cx("mp-trigger", loading && "mp-trigger-loading")}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled || loading || empty}
        onClick={() => setOpen((value) => !value)}
        title={selected?.name}
      >
        {selected?.reasoning ? (
          <Brain size={14} aria-hidden="true" />
        ) : (
          <Sparkles size={14} aria-hidden="true" />
        )}
        <span className="mp-trigger-name">
          {loading
            ? "Modelle laden…"
            : empty
              ? (props.error ?? "Kein Modell verfügbar")
              : (selected?.name ?? "Modell wählen")}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="mp-chevron" />
      </button>
      {open ? (
        <div className="mp-pop" role="dialog" aria-label="Modell wählen">
          <label className="mp-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              placeholder={`${props.models?.length ?? 0} Modelle durchsuchen`}
              aria-controls={listId}
              aria-activedescendant={
                flat[cursor] ? `${listId}-${cursor}` : undefined
              }
            />
          </label>
          {props.freeOnly ? (
            <p className="mp-note">
              Free-Plan: kostenlose Modelle. Mit einem Abo sind alle Modelle
              frei.
            </p>
          ) : null}
          <div
            className="mp-list"
            id={listId}
            role="listbox"
            aria-label="Modelle"
          >
            {groups.length === 0 ? (
              <p className="mp-empty">Kein Modell passt zu „{query}“.</p>
            ) : (
              groups.map((group) => (
                <div
                  key={group.label}
                  className="mp-group"
                  role="group"
                  aria-label={group.label}
                >
                  <p className="mp-group-label">{group.label}</p>
                  {group.models.map((model) => {
                    index += 1;
                    const position = index;
                    const active = position === cursor;
                    const chosen = model.id === props.value;
                    return (
                      <button
                        type="button"
                        key={model.id}
                        id={`${listId}-${position}`}
                        role="option"
                        aria-selected={chosen}
                        className={cx(
                          "mp-item",
                          active && "mp-item-active",
                          chosen && "mp-item-chosen",
                        )}
                        onMouseEnter={() => setCursor(position)}
                        onClick={() => choose(model.id)}
                      >
                        <span className="mp-item-main">
                          <span className="mp-item-name">{model.name}</span>
                          {contextLabel(model.contextLength) ? (
                            <span className="mp-item-meta">
                              {contextLabel(model.contextLength)} Kontext
                            </span>
                          ) : null}
                        </span>
                        <span className="mp-badges">
                          {model.reasoning ? (
                            <span className="mp-badge mp-badge-think">
                              Denkt
                            </span>
                          ) : null}
                          {model.free ? (
                            <span className="mp-badge mp-badge-free">Free</span>
                          ) : null}
                          {chosen ? (
                            <Check size={14} aria-hidden="true" />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
