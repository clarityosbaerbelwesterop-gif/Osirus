import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "./types";

export class InMemoryEventJournal {
  private events: RuntimeEvent[] = [];

  constructor(
    private readonly defaultRunId = "00000000-0000-0000-0000-000000000001",
  ) {}

  append(
    event: Omit<RuntimeEvent, "id" | "sequence" | "at" | "runId"> & {
      runId?: string;
    },
  ) {
    const next: RuntimeEvent = {
      ...event,
      id: randomUUID(),
      runId: event.runId ?? this.defaultRunId,
      sequence: this.events.length + 1,
      at: new Date().toISOString(),
    };
    this.events.push(next);
    return next;
  }

  list() {
    return [...this.events];
  }
}

export const EventJournal = InMemoryEventJournal;

export function reconstruct(events: RuntimeEvent[]) {
  return events.reduce<Record<string, unknown>>(
    (state, event) => ({ ...state, ...event.data }),
    {},
  );
}
