"use client";

import {
  Gauge,
  House,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useMemo, useState } from "react";
import { SIDEBAR_COOKIE, writePreference } from "@/lib/ui/preferences";
import { OsirusMark } from "../shell/osirus-mark";
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

const PRIMARY: NavItem[] = [
  { href: "/app" as Route, label: "Home", icon: House },
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
  const pinned = Boolean(session.pinnedAt);

  const togglePin = async () => {
    setPinBusy(true);
    const response = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    }).catch(() => null);
    setPinBusy(false);
    if (response?.ok) shell.setPinned(session.id, !pinned);
  };

  return (
    <li className={cx("session-row", active && "session-row-active")}>
      <Link
        href={{ pathname: "/app", query: { session: session.id } }}
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
      <IconButton
        className="session-pin"
        size="sm"
        label={pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
        icon={pinned ? PinOff : Pin}
        tooltip={false}
        disabled={pinBusy}
        onClick={() => void togglePin()}
      />
    </li>
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

  const { pinned, recent } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? shell.sessions.filter((item) =>
          item.title.toLowerCase().includes(needle),
        )
      : shell.sessions;
    return {
      pinned: matches.filter((item) => item.pinnedAt),
      recent: matches.filter((item) => !item.pinnedAt).slice(0, 40),
    };
  }, [search, shell.sessions]);

  const newTask = () => {
    onNavigate?.();
    if (shell.chat) shell.chat.newTask();
    else router.push("/app?new=1" as Route);
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
