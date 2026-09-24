"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { RelativeTime } from "../ui/relative-time";

export type MemoryListItem = {
  id: string;
  kind: string;
  content: string;
  verified: boolean;
  own: boolean;
  createdAt: string;
  contradictionStatus?: "none" | "suspected" | "resolved";
};

export type MemoryConflictItem = {
  id: string;
  kind: string;
  content: string;
  subjectKey: string | null;
  canonicalValue: string | null;
  updatedAt: string;
  rivalIds: string[];
};

export function MemoryList({ items }: { items: MemoryListItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const forget = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/memory/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setError("That memory could not be removed.");
    router.refresh();
  };
  return (
    <>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id} className="item">
            <span aria-hidden="true" />
            <div className="item-body">
              <p className="wrap-anywhere">{item.content}</p>
              <p className="item-meta">
                {item.kind.replaceAll("_", " ")} ·{" "}
                <RelativeTime value={item.createdAt} />
              </p>
            </div>
            <div className="item-side">
              <Badge tone={item.verified ? "success" : "neutral"}>
                {item.verified ? "Verified" : "Not verified"}
              </Badge>
              {item.own ? (
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label="Forget this memory"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Forget
                    </button>
                  }
                  title="Forget this memory?"
                  description="Osirus will no longer use it in future runs. This cannot be undone."
                  confirmLabel="Forget"
                  onConfirm={() => void forget(item.id)}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MemoryConflictList({ items }: { items: MemoryConflictItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const resolve = async (item: MemoryConflictItem) => {
    setError(null);
    setBusyId(item.id);
    const response = await fetch("/api/memory/conflicts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        winningMemoryId: item.id,
        rejectedMemoryIds: item.rivalIds.filter((id) => id !== item.id),
      }),
    }).catch(() => null);
    setBusyId(null);
    if (!response?.ok) {
      setError("That contradiction could not be resolved.");
      return;
    }
    router.refresh();
  };
  if (!items.length) return null;
  return (
    <>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id} className="item">
            <span aria-hidden="true" />
            <div className="item-body">
              <p className="wrap-anywhere">{item.content}</p>
              <p className="item-meta">
                {item.subjectKey ?? "unknown subject"} ·{" "}
                <RelativeTime value={item.updatedAt} />
              </p>
            </div>
            <div className="item-side">
              <Badge tone="warning">Needs review</Badge>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busyId === item.id}
                onClick={() => void resolve(item)}
              >
                Keep this value
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
