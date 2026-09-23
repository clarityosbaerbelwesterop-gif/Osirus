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
export const metadata: Metadata = { title: "Approvals" };

const FILTERS: Array<{ id: ApprovalFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
];

const EMPTY: Record<ApprovalFilter, string> = {
  pending: "Nothing is waiting for you.",
  approved: "No approved requests yet.",
  rejected: "No rejected requests.",
  expired: "No expired requests.",
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
      title="Approvals"
      lede="Every action Osirus asked you to decide, with what it would do and where. Each approval covers one exact call."
    >
      <nav className="filter-tabs" aria-label="Approval status">
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
