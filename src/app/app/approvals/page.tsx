import type { Metadata, Route } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ApprovalList } from "@/components/approvals/approval-list";
import { PageFrame } from "@/components/shell/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import {
  approvalCounts,
  listApprovals,
  type ApprovalFilter,
} from "@/lib/product/approvals";
import { requireProductSession } from "@/lib/product/session";
import { approvalView } from "@/lib/ui/approval-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Freigaben" };

const FILTERS: Array<{ id: ApprovalFilter; label: string }> = [
  { id: "pending", label: "Offen" },
  { id: "approved", label: "Freigegeben" },
  { id: "rejected", label: "Abgelehnt" },
  { id: "expired", label: "Abgelaufen" },
];

const EMPTY: Record<ApprovalFilter, string> = {
  pending: "Gerade wartet nichts auf dich.",
  approved: "Noch keine freigegebenen Anfragen.",
  rejected: "Keine abgelehnten Anfragen.",
  expired: "Keine abgelaufenen Anfragen.",
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { identity } = await requireProductSession();
  const { status } = await searchParams;
  const filter: ApprovalFilter = FILTERS.some((item) => item.id === status)
    ? (status as ApprovalFilter)
    : "pending";
  const [rows, counts] = await Promise.all([
    listApprovals(identity, filter),
    approvalCounts(identity),
  ]);
  const items = rows.map((row) => ({
    view: approvalView(row),
    runId: row.run_id,
    sessionId: row.session_id,
    objective: row.objective,
  }));
  return (
    <PageFrame
      title="Freigaben"
      lede="Jede Aktion, über die Osirus dich entscheiden ließ, mit dem, was sie tun würde und wo. Jede Freigabe gilt für genau einen Aufruf."
    >
      <nav className="filter-tabs" aria-label="Status der Freigaben">
        {FILTERS.map((item) => (
          <Link
            key={item.id}
            href={`/app/approvals?status=${item.id}` as Route}
            aria-current={item.id === filter ? "page" : undefined}
          >
            {item.label}
            <span className="count count-quiet">{counts[item.id]}</span>
          </Link>
        ))}
      </nav>
      <div className="section">
        {items.length ? (
          <ApprovalList items={items} />
        ) : (
          <EmptyState icon={ShieldCheck} title={EMPTY[filter]} />
        )}
      </div>
    </PageFrame>
  );
}
