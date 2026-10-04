"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Gauge,
  Bot,
  Code2,
  Inbox,
  MessageSquare,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { SIDEBAR_COOKIE, writePreference } from "@/lib/ui/preferences";
import { OsirusMark } from "../shell/osirus-mark";
import {
  sessionsForSurface,
  surfacePath,
  type SessionSurface,
} from "@/lib/product/surfaces";
import { useShell, type SessionSummary } from "../shell/shell-context";
import { SystemStatus } from "./system-status";
import { cx } from "../ui/cx";
import { IconButton } from "../ui/icon-button";

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  count?: "inbox" | "approvals";
  admin?: boolean;
};

const SURFACES: NavItem[] = [
  { href: "/app" as Route, label: "Chat", icon: MessageSquare },
  { href: "/app/agent" as Route, label: "Agent", icon: Sparkles },
  { href: "/app/bots" as Route, label: "Bot", icon: Bot },
  { href: "/app/coding" as Route, label: "Coding", icon: Code2 },
];

const PRIMARY: NavItem[] = [
  { href: "/app/inbox" as Route, label: "Inbox", icon: Inbox, count: "inbox" },
  {
    href: "/app/approvals" as Route,
    label: "Approvals",
    icon: ShieldCheck,
    count: "approvals",
  },
  { href: "/app/automations" as Route, label: "Automations", icon: Timer },
];

const CONFIGURE: NavItem[] = [
  { href: "/app/connections" as Route, label: "Connections", icon: Plug },
  { href: "/app/quality" as Route, label: "Quality", icon: Gauge, admin: true },
  { href: "/app/settings" as Route, label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  count: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const active = isActive(pathname, item.href);
  const label = count ? `${item.label}, ${count} waiting` : item.label;
  return (
    <Link
      href={item.href}
      className={cx("nav-link", active && "nav-link-active")}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <item.icon size={17} aria-hidden="true" />
      {collapsed ? (
        count ? (
          <span className="nav-dot" aria-hidden="true" />
        ) : null
      ) : (
        <>
          <span className="nav-label">{item.label}</span>
          {count ? (
            <span className="count" aria-label={`${count} waiting`}>
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}

async function patchSession(id: string, body: Record<string, unknown>) {
  return fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

function SessionLink({
  session,
  onNavigate,
}: {
  session: SessionSummary;
  onNavigate?: () => void;
}) {
  const shell = useShell();
  const chat = shell.chat;
  const active = chat?.activeSessionId === session.id;
  const locked = Boolean(chat?.running) && !active;
  const [pinBusy, setPinBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const renameCancelled = useRef(false);
  const pinned = Boolean(session.pinnedAt);

  const togglePin = async () => {
    setPinBusy(true);
    const response = await patchSession(session.id, { pinned: !pinned });
    setPinBusy(false);
    if (response?.ok) shell.setPinned(session.id, !pinned);
  };

  const startRename = () => {
    setDraft(session.title);
    renameCancelled.current = false;
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const title = draft.trim();
    if (!title || title === session.title) return;
    const previous = session.title;
    shell.renameSession(session.id, title);
    const response = await patchSession(session.id, { title });
    if (!response?.ok) shell.renameSession(session.id, previous);
  };

  const cancelRename = () => {
    renameCancelled.current = true;
    setEditing(false);
  };

  const archive = async () => {
    shell.removeSession(session.id);
    const response = await patchSession(session.id, { archived: true });
    if (!response?.ok) shell.upsertSession(session);
  };

  if (editing) {
    return (
      <li className={cx("session-row", active && "session-row-active")}>
        <input
          ref={(input) => {
            input?.focus();
            input?.select();
          }}
          className="session-rename"
          value={draft}
          aria-label={`Rename ${session.title}`}
          maxLength={240}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (renameCancelled.current) return;
            void commitRename();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelRename();
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className={cx("session-row", active && "session-row-active")}>
      <Link
        href={{
          pathname: surfacePath(session.surface ?? "ai") as Route,
          query: { session: session.id },
        }}
        className="session-link"
        aria-current={active ? "page" : undefined}
        aria-disabled={locked || undefined}
        title={
          locked ? "Finish or cancel the current run first" : session.title
        }
        onClick={(event) => {
          if (locked) {
            event.preventDefault();
            return;
          }
          if (chat) {
            event.preventDefault();
            chat.select(session);
          }
          onNavigate?.();
        }}
      >
        <span className="truncate">{session.title}</span>
      </Link>
      <span className="session-actions">
        <IconButton
          size="sm"
          label={`Rename ${session.title}`}
          icon={Pencil}
          tooltip={false}
          onClick={startRename}
        />
        <IconButton
          size="sm"
          label={pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
          icon={pinned ? PinOff : Pin}
          tooltip={false}
          disabled={pinBusy}
          onClick={() => void togglePin()}
        />
        <IconButton
          size="sm"
          label={`Archive ${session.title}`}
          icon={Archive}
          tooltip={false}
          onClick={() => void archive()}
        />
      </span>
    </li>
  );
}

function ArchivedSessions({
  surface,
}: {
  surface: SessionSurface | null;
}) {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setSessions(null);
    const response = await fetch("/api/sessions?archived=1").catch(() => null);
    if (response?.ok) setSessions((await response.json()) as SessionSummary[]);
  };

  const unarchive = async (session: SessionSummary) => {
    const previous = sessions;
    setSessions(
      (current) => current?.filter((item) => item.id !== session.id) ?? null,
    );
    const response = await patchSession(session.id, { archived: false });
    if (response?.ok) shell.upsertSession(session);
    else setSessions(previous);
  };

  const visible = sessions
    ? sessionsForSurface(sessions, surface)
    : null;

  return (
    <section aria-labelledby="archived-heading">
      <button
        type="button"
        className="sidebar-heading overline sidebar-disclosure"
        id="archived-heading"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cx(
            "sidebar-disclosure-icon",
            open && "sidebar-disclosure-icon-open",
          )}
        />
        <span className="nav-label">Archived</span>
        {visible?.length ? (
          <span className="count" aria-label={`${visible.length} archived`}>
            {visible.length > 99 ? "99+" : visible.length}
          </span>
        ) : null}
      </button>
      {open ? (
        visible?.length ? (
          <ul className="session-list">
            {visible.map((session) => (
              <li key={session.id} className="session-row">
                <span className="session-link session-archived">
                  <span className="truncate">{session.title}</span>
                </span>
                <span className="session-actions">
                  <IconButton
                    size="sm"
                    label={`Restore ${session.title}`}
                    icon={ArchiveRestore}
                    tooltip={false}
                    onClick={() => void unarchive(session)}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sidebar-empty">
            {visible ? "No archived conversations." : "Loading…"}
          </p>
        )
      ) : null}
    </section>
  );
}

export function SidebarContent({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const shell = useShell();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const pathname = usePathname() ?? "";
  const listSurface =
    pathname === "/app"
      ? "ai"
      : pathname.startsWith("/app/agent")
        ? "agent"
        : pathname.startsWith("/app/bots")
          ? "bot"
          : pathname.startsWith("/app/coding")
            ? "coding"
            : null;
  const { pinned, recent } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const scoped = sessionsForSurface(shell.sessions, listSurface);
    const matches = needle
      ? scoped.filter((item) => item.title.toLowerCase().includes(needle))
      : scoped;
    return {
      pinned: matches.filter((item) => item.pinnedAt),
      recent: matches.filter((item) => !item.pinnedAt).slice(0, 40),
    };
  }, [listSurface, search, shell.sessions]);

  const newTask = () => {
    onNavigate?.();
    if (shell.chat) shell.chat.newTask();
    else {
      const path =
        listSurface === "agent"
          ? "/app/agent?new=1"
          : listSurface === "bot"
            ? "/app/bots?new=1"
            : listSurface === "coding"
              ? "/app/coding?new=1"
              : "/app?new=1";
      router.push(path as Route);
    }
  };

  const toggleCollapsed = () => {
    const next = collapsed ? "expanded" : "collapsed";
    shell.setSidebar(next);
    writePreference(SIDEBAR_COOKIE, next);
  };

  const count = (item: NavItem) => (item.count ? shell.counts[item.count] : 0);

  return (
    <div className={cx("sidebar-inner", collapsed && "sidebar-collapsed")}>
      <div className="sidebar-brand">
        <Link
          href={"/app" as Route}
          className="brand-link"
          onClick={onNavigate}
        >
          <OsirusMark />
          {collapsed ? (
            <span className="sr-only">Osirus home</span>
          ) : (
            <span className="brand-text">
              <span className="brand-name">Osirus</span>
              <span className="brand-workspace truncate">
                {shell.workspaceName}
              </span>
            </span>
          )}
        </Link>
        {onNavigate ? null : (
          <IconButton
            className="sidebar-collapse"
            size="sm"
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            onClick={toggleCollapsed}
          />
        )}
      </div>

      {collapsed ? (
        <IconButton
          className="sidebar-new-icon"
          label="New task"
          icon={Plus}
          disabled={shell.chat?.running}
          onClick={newTask}
        />
      ) : (
        <div className="sidebar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-block sidebar-new"
            onClick={newTask}
            disabled={shell.chat?.running}
          >
            <Plus size={16} aria-hidden="true" />
            New task
          </button>
          <label className="sidebar-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search conversations</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
            />
          </label>
        </div>
      )}

      <nav className="sidebar-nav" aria-label="Main">
        <ul>
          {SURFACES.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                collapsed={collapsed}
                count={0}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
        <ul>
          {PRIMARY.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                collapsed={collapsed}
                count={count(item)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
        <ul>
          {CONFIGURE.filter((item) => !item.admin || shell.isAdmin).map(
            (item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  collapsed={collapsed}
                  count={count(item)}
                  onNavigate={onNavigate}
                />
              </li>
            ),
          )}
        </ul>
      </nav>

      {collapsed ? (
        <div className="spacer" />
      ) : (
        <div className="sidebar-sessions">
          {pinned.length ? (
            <section aria-labelledby="pinned-heading">
              <h2 className="sidebar-heading overline" id="pinned-heading">
                Pinned
              </h2>
              <ul className="session-list">
                {pinned.map((session) => (
                  <SessionLink
                    key={session.id}
                    session={session}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="recent-heading">
            <h2 className="sidebar-heading overline" id="recent-heading">
              Recent
            </h2>
            {recent.length ? (
              <ul className="session-list">
                {recent.map((session) => (
                  <SessionLink
                    key={session.id}
                    session={session}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            ) : (
              <p className="sidebar-empty">
                {search
                  ? "No matching conversations."
                  : "No conversations yet."}
              </p>
            )}
          </section>
          <ArchivedSessions surface={listSurface} />
        </div>
      )}

      <div className="sidebar-footer">
        <Link
          href={"/app/settings" as Route}
          className="account-link"
          onClick={onNavigate}
          aria-label={collapsed ? "Account settings" : undefined}
        >
          <span className="avatar" aria-hidden="true">
            {(shell.user.name ?? shell.user.email ?? "?")
              .slice(0, 1)
              .toUpperCase()}
          </span>
          {collapsed ? null : (
            <span className="account-text">
              <span className="truncate">
                {shell.user.name ?? shell.user.email ?? "Account"}
              </span>
              <SystemStatus />
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}

export function Sidebar() {
  const shell = useShell();
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <SidebarContent collapsed={shell.sidebar === "collapsed"} />
    </aside>
  );
}
