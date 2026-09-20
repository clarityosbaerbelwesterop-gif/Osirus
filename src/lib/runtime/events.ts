import type { RuntimeEvent } from "./types";
export class EventJournal {
  #events: RuntimeEvent[] = [];
  append(event: RuntimeEvent) {
    this.#events.push(Object.freeze({ ...event, data: { ...event.data } }));
    return event;
  }
  forRun(runId: string) {
    return this.#events.filter((e) => e.runId === runId);
  }
  reconstruct(runId: string) {
    return this.forRun(runId).reduce<Record<string, unknown>>(
      (s, e) => ({
        ...s,
        lastEvent: e.type,
        lastStage: e.stage,
        lastAt: e.at,
        ...e.data,
      }),
      {},
    );
  }
}
