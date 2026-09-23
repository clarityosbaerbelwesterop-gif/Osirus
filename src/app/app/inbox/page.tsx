import type { Metadata, Route } from "next";
import Link from "next/link";
import { InboxView, type InboxItem } from "@/components/inbox/inbox-view";
import { PageFrame } from "@/components/shell/page-frame";
import { listApprovals } from "@/lib/product/approvals";
import { listNotifications } from "@/lib/product/notifications";
import { requireProductSession } from "@/lib/product/session";
import { approvalView } from "@/lib/ui/approval-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

type Tab = "needs-you" | "completed" | "failed" | "updates";

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  {
    id: "needs-you",
    label: "Needs you",
    empty: "Nothing needs you right now.",
  },
  {
    id: "completed",
    label: "Completed",
    empty: "No completed automations yet.",
  },
  { id: "failed", label: "Failed", empty: "Nothing failed." },
  { id: "updates", label: "Updates", empty: "No updates." },
];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { identity } = await requireProductSession();
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.some((item) => item.id === rawTab)
    ? (rawTab as Tab)
    : "needs-you";
  const [notifications, pending] = await Promise.all([
    listNotifications(identity),
    listApprovals(identity, "pending", 50),
  ]);

  const sessionHref = (sessionId: string | null) =>
    sessionId ? `/app?session=${sessionId}` : null;

  // Pending approvals are live state, not notifications: they leave the list
  // the moment they are decided or expire.
  const pendingItems: InboxItem[] = pending.map((row) => {
    const view = approvalView(row);
    return {
      id: `approval:${view.id}`,
      kind: "approval_pending",
      title: `Approve: ${view.title}`,
      body: row.objective ? `For “${row.objective}”` : view.scope,
      href: sessionHref(row.session_id) ?? "/app/approvals",
      read: false,
      createdAt: view.createdAt ?? new Date().toISOString(),
    };
  });
  const toItem = (n: (typeof notifications)[number]): InboxItem => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href:
      n.kind === "connector_expired"
        ? "/app/connections"
        : (sessionHref(n.sessionId) ??
          (n.automationId ? "/app/automations" : null)),
    read: n.read,
    createdAt: n.createdAt,
  });

  const byTab: Record<Tab, InboxItem[]> = {
    "needs-you": [
      ...pendingItems,
      ...notifications
        .filter(
          (n) =>
            !n.read &&
            (n.kind === "run_blocked" || n.kind === "connector_expired"),
        )
        .map(toItem),
    ],
    completed: notifications
      .filter((n) => n.kind === "automation_completed")
      .map(toItem),
    failed: notifications
      .filter((n) => n.kind === "automation_failed" || n.kind === "run_blocked")
      .map(toItem),
    updates: notifications
      .filter(
        (n) => n.kind === "connector_expired" || n.kind === "approval_needed",
      )
      .map(toItem),
  };
  const counts = Object.fromEntries(
    TABS.map((item) => [
      item.id,
      byTab[item.id].filter((entry) => !entry.read).length,
    ]),
  ) as Record<Tab, number>;
  const current = TABS.find((item) => item.id === tab)!;
  const unreadIds = byTab[tab]
    .filter((item) => !item.read && item.kind !== "approval_pending")
    .map((item) => item.id);

  return (
    <PageFrame
      title="Inbox"
      lede="Only what needs you or finished while you were away. Routine progress stays in each conversation."
    >
      <nav className="filter-tabs" aria-label="Inbox sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/app/inbox?tab=${item.id}` as Route}
            aria-current={item.id === tab ? "page" : undefined}
          >
            {item.label}
            {counts[item.id] ? (
              <span className="count">{counts[item.id]}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className="section">
        <InboxView
          items={byTab[tab]}
          unreadIds={unreadIds}
          emptyTitle={current.empty}
        />
      </div>
    </PageFrame>
  );
}
