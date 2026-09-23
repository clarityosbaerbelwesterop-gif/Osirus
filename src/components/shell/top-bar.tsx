"use client";

import { Inbox, Menu as MenuIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { IconButton } from "../ui/icon-button";
import { useShell } from "./shell-context";
import { ThemeMenu } from "./theme-menu";

/**
 * The page header. On narrow screens it carries the navigation button; on all
 * screens the inbox and theme. Pages add their own actions and a status.
 */
export function TopBar({
  title,
  status,
  actions,
}: {
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const shell = useShell();
  const inbox = shell.counts.inbox;
  return (
    <header className="topbar">
      <IconButton
        className="topbar-nav"
        label="Open navigation"
        icon={MenuIcon}
        tooltip={false}
        aria-expanded={shell.navOpen}
        onClick={() => shell.setNavOpen(true)}
      />
      <div className="topbar-title">
        <h1 className="truncate">{title}</h1>
        {status}
      </div>
      <div className="topbar-actions">
        {actions}
        <Link
          href={"/app/inbox" as Route}
          className="icon-btn topbar-inbox"
          aria-label={
            inbox
              ? `Inbox, ${inbox} need${inbox === 1 ? "s" : ""} you`
              : "Inbox"
          }
        >
          <Inbox size={17} aria-hidden="true" />
          {inbox ? <span className="topbar-dot" aria-hidden="true" /> : null}
        </Link>
        <ThemeMenu />
      </div>
    </header>
  );
}
