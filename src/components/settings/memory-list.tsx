"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";

export type MemoryListItem = {
  id: string;
  kind: string;
  content: string;
  verified: boolean;
  own: boolean;
  createdAt: string;
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
                {relativeTime(item.createdAt)}
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
