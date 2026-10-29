"use client";

import { useSyncExternalStore } from "react";
import { activityLabel } from "@/lib/ui/labels";
import type { RunView } from "@/lib/ui/run-view";
import { BotOrb } from "../bots/bot-orb";

// What a working run looks like: the surface's own orb, the step it is on
// right now, how long it has been at it, and the last things it did, as
// they happen. The Rouge Agent glows warm, Code cool. Nothing here is a
// progress fraction or an internal stage id.

export type LiveKind = "agent" | "coding";

const HUES: Record<LiveKind, [number, number, number]> = {
  agent: [350, 18, 286],
  coding: [192, 228, 160],
};

const FEED = 4;

function subscribeClock(onTick: () => void) {
  const timer = window.setInterval(onTick, 1000);
  return () => window.clearInterval(timer);
}

/** The time on the client, ticking each second; null while rendering on the server. */
function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => null,
  );
}

function elapsed(fromIso: string | null, now: number | null) {
  if (!fromIso || now === null) return null;
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")} Min.`
    : `${seconds} Sek.`;
}

export function liveKindOf(view: Pick<RunView, "armId">): LiveKind {
  return view.armId === "coding" ? "coding" : "agent";
}

/** The run at work. `line` is the honest status sentence for this moment. */
export function LiveRun({
  view,
  line,
  kind = liveKindOf(view),
}: {
  view: RunView;
  line: string;
  kind?: LiveKind;
}) {
  const now = useNow();
  const waiting = view.status === "waiting_for_approval";
  const feed = view.evidence.slice(-FEED);
  const latest = feed.at(-1);
  const headline =
    waiting || view.failure
      ? line
      : latest
        ? activityLabel(latest.label)
        : line;
  const time = elapsed(view.evidence[0]?.at ?? null, now);
  return (
    <div className="live-run" data-kind={kind} data-waiting={waiting}>
      <div className="live-run-head">
        <BotOrb
          seed={kind}
          hues={HUES[kind]}
          size={34}
          state={waiting ? "listening" : "thinking"}
        />
        <div className="live-run-text">
          <p className="live-run-now" role="status" key={headline}>
            {headline}
          </p>
          <p className="live-run-meta">
            {kind === "coding" ? "Code" : "Rouge Agent"}
            {time ? ` · seit ${time}` : ""}
            {view.evidence.length > 1
              ? ` · ${view.evidence.length} Aktionen`
              : ""}
          </p>
        </div>
      </div>
      {feed.length > 1 ? (
        <ol className="live-run-feed" aria-label="Zuletzt erledigt">
          {feed.slice(0, -1).map((item, index) => (
            <li
              key={item.id}
              style={{ ["--age" as string]: String(feed.length - 2 - index) }}
            >
              {activityLabel(item.label)}
            </li>
          ))}
        </ol>
      ) : null}
      <span className="live-run-sheen" aria-hidden="true" />
    </div>
  );
}

/** Before the first snapshot: the orb and one word, nothing invented. */
export function LiveRunStarting({ kind }: { kind: LiveKind }) {
  return (
    <div className="live-run live-run-starting" data-kind={kind}>
      <div className="live-run-head">
        <BotOrb seed={kind} hues={HUES[kind]} size={34} state="thinking" />
        <div className="live-run-text">
          <p className="live-run-now" role="status">
            Startet …
          </p>
          <p className="live-run-meta">
            {kind === "coding"
              ? "Code bereitet die Arbeitsumgebung vor"
              : "Rouge Agent plant die Schritte"}
          </p>
        </div>
      </div>
      <span className="live-run-sheen" aria-hidden="true" />
    </div>
  );
}
