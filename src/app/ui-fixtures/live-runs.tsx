"use client";

import { RunCard } from "@/components/run-status/run-card";
import type { RunSnapshot } from "@/lib/runtime/types";
import { deriveRunView } from "@/lib/ui/run-view";

/** Fixture only: the Rouge Agent and Code at work, side by side. */
export function LiveRunsFixture({ snapshots }: { snapshots: RunSnapshot[] }) {
  return (
    <div className="chat-page">
      <div className="chat-column">
        <div className="chat-scroll">
          <div className="chat-content">
            {snapshots.map((snapshot) => (
              <RunCard
                key={snapshot.run.armId ?? "run"}
                view={deriveRunView(snapshot)}
                resumed={false}
                onRefresh={() => undefined}
                onOpenWorkbench={null}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
