"use client";

import {
  CheckCircle2,
  CircleAlert,
  Inbox,
  PlugZap,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationKind } from "@/lib/product/notifications-types";
import { relativeTime } from "@/lib/ui/labels";
import { EmptyState } from "../ui/empty-state";
import { cx } from "../ui/cx";

export type InboxItem = {
  id: string;
  kind: NotificationKind | "approval_pending";
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
};

const ICON: Record<InboxItem["kind"], { icon: LucideIcon; tone: string }> = {
  approval_pending: { icon: ShieldAlert, tone: "tone-warning" },
  approval_needed: { icon: ShieldAlert, tone: "tone-warning" },
  automation_completed: { icon: CheckCircle2, tone: "tone-success" },
  automation_failed: { icon: CircleAlert, tone: "tone-danger" },
  run_blocked: { icon: CircleAlert, tone: "tone-danger" },
  connector_expired: { icon: PlugZap, tone: "tone-warning" },
};

export function InboxView({
  items,
  unreadIds,
  emptyTitle,
}: {
  items: InboxItem[];
  unreadIds: string[];
  emptyTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const markRead = async (read: string[] | "all") => {
    setBusy(true);
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read }),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="stack">
      {unreadIds.length ? (
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void markRead("all")}
          >
            Mark all as read
          </button>
        </div>
      ) : null}
      {items.length ? (
        <ul className="item-list">
          {items.map((item) => {
            const info = ICON[item.kind];
            return (
              <li
                key={item.id}
                className={cx("item", !item.read && "item-unread")}
              >
                <info.icon size={16} aria-hidden="true" className={info.tone} />
                <div className="item-body">
                  <p className="item-title">
                    {!item.read ? (
                      <span className="sr-only">Unread: </span>
                    ) : null}
                    {item.title}
                  </p>
                  {item.body ? (
                    <p className="wrap-anywhere">{item.body}</p>
                  ) : null}
                  <p className="item-meta">
                    <time dateTime={item.createdAt}>
                      {relativeTime(item.createdAt)}
                    </time>
                  </p>
                </div>
                <div className="item-side">
                  {item.href ? (
                    <Link
                      className="btn btn-secondary btn-sm"
                      href={item.href as Route}
                      onClick={() => {
                        if (!item.read && item.kind !== "approval_pending")
                          void markRead([item.id]);
                      }}
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Inbox} title={emptyTitle} />
      )}
    </div>
  );
}
