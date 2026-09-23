"use client";

import { MessageSquare } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ApprovalView } from "@/lib/ui/approval-view";
import { relativeTime } from "@/lib/ui/labels";
import { ApprovalCard } from "./approval-card";

export type ApprovalListItem = {
  view: ApprovalView;
  runId: string;
  sessionId: string | null;
  objective: string | null;
};

export function ApprovalList({ items }: { items: ApprovalListItem[] }) {
  const router = useRouter();
  return (
    <ul className="item-list">
      {items.map((item) => (
        <li key={item.view.id} className="approval-row">
          <div className="approval-context subtle">
            <span className="wrap-anywhere">
              {item.objective ? `“${item.objective}”` : "A run"}
            </span>
            <span>
              {item.view.createdAt ? relativeTime(item.view.createdAt) : null}
            </span>
            {item.sessionId ? (
              <Link
                href={`/app?session=${item.sessionId}` as Route}
                className="row"
              >
                <MessageSquare size={13} aria-hidden="true" />
                Open conversation
              </Link>
            ) : null}
          </div>
          <ApprovalCard
            approval={item.view}
            runId={item.runId}
            onDecided={() => router.refresh()}
          />
        </li>
      ))}
    </ul>
  );
}
