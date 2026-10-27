"use client";

import {
  Code2,
  MessageSquare,
  Search,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { groupSessions } from "@/lib/product/session-groups";
import { cx } from "../ui/cx";
import { BotOrb } from "./bot-orb";

export type HistoryKind = "chat" | "bot" | "group" | "rouge" | "code";

export type HistoryEntry = {
  id: string;
  title: string;
  updatedAt: string;
  kind: HistoryKind;
  href: string;
  /** The bot of a bot thread, or the members of a group. */
  seeds: string[];
  detail: string | null;
};

const FILTERS: { id: HistoryKind | "all"; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "chat", label: "Chats" },
  { id: "bot", label: "Bots" },
  { id: "group", label: "Gruppen" },
  { id: "rouge", label: "Rouge Agent" },
  { id: "code", label: "Code" },
];

const ICON: Record<HistoryKind, LucideIcon> = {
  chat: MessageSquare,
  bot: MessageSquare,
  group: Users,
  rouge: Zap,
  code: Code2,
};

const KIND_LABEL: Record<HistoryKind, string> = {
  chat: "Chat",
  bot: "Bot",
  group: "Gruppe",
  rouge: "Rouge Agent",
  code: "Code",
};

const subscribeNever = () => () => undefined;
const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};
const noDay = () => null;

/** Every conversation of the workspace, across all areas, by day. */
export function HistoryBrowser({ entries }: { entries: HistoryEntry[] }) {
  const [filter, setFilter] = useState<HistoryKind | "all">("all");
  const [search, setSearch] = useState("");
  const day = useSyncExternalStore(subscribeNever, today, noDay);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = entries.filter(
      (entry) =>
        (filter === "all" || entry.kind === filter) &&
        (!needle ||
          entry.title.toLowerCase().includes(needle) ||
          entry.detail?.toLowerCase().includes(needle)),
    );
    return day === null
      ? [{ id: "all", label: "Verlauf", items: visible }]
      : groupSessions(visible, new Date(day));
  }, [day, entries, filter, search]);

  const counts = useMemo(() => {
    const map = new Map<string, number>([["all", entries.length]]);
    for (const entry of entries)
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1);
    return map;
  }, [entries]);

  return (
    <div className="history">
      <div className="history-controls">
        <label className="history-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Verlauf durchsuchen</span>
          <input
            type="search"
            value={search}
            placeholder="Verlauf durchsuchen"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="history-filters" role="group" aria-label="Bereich">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx(
                "history-filter",
                filter === item.id && "history-filter-on",
              )}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="history-count">{counts.get(item.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {groups.every((group) => group.items.length === 0) ? (
        <p className="subtle">
          {search ? "Nichts passt zur Suche." : "Hier ist noch nichts."}
        </p>
      ) : (
        groups.map((group) =>
          group.items.length ? (
            <section key={group.id} aria-labelledby={`h-${group.id}`}>
              <h2 className="overline history-day" id={`h-${group.id}`}>
                {group.label}
              </h2>
              <ul className="history-list">
                {group.items.map((entry) => {
                  const Icon = ICON[entry.kind];
                  return (
                    <li key={`${entry.kind}-${entry.id}`}>
                      <Link href={entry.href as Route} className="history-row">
                        <span className="history-icon" aria-hidden="true">
                          {entry.seeds.length ? (
                            <BotOrb seed={entry.seeds[0]} size={22} />
                          ) : (
                            <Icon size={16} />
                          )}
                        </span>
                        <span className="history-text">
                          <span className="history-title truncate">
                            {entry.title}
                          </span>
                          <span className="history-detail truncate">
                            {KIND_LABEL[entry.kind]}
                            {entry.detail ? ` · ${entry.detail}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
        )
      )}
    </div>
  );
}
