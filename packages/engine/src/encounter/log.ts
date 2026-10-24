import type { EncounterEvent } from "./events.js";

/** An encounter event with its position in the ordered change log. */
export interface LoggedEvent {
  seq: number;
  event: EncounterEvent;
}

/** Ordered record of every encounter mutation, read by position (`seq`). */
export interface EncounterLog {
  /** The `seq` of the newest event, or 0 when the log is empty. */
  latestSeq(): number;
  /** Events with a `seq` greater than the given one, oldest first. */
  eventsSince(seq: number): LoggedEvent[];
}
