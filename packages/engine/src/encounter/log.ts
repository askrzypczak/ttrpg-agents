import type { EncounterEvent } from "./events.js";

/** An encounter event with its position in the ordered change log. */
export interface LoggedEvent {
  seq: number;
  event: EncounterEvent;
}

/**
 * A log row the reader could not parse, for example one written by a newer
 * schema. `error` is the parse error message.
 */
export interface UnreadableLogEntry {
  seq: number;
  error: string;
}

/** Ordered record of every encounter mutation, read by position (`seq`). */
export interface EncounterLog {
  /** The `seq` of the newest event, or 0 when the log is empty. */
  latestSeq(): number;
  /**
   * Events with a `seq` greater than the given one, oldest first. A row the
   * reader cannot parse comes back as an unreadable entry in its place, so the
   * caller keeps its position.
   */
  eventsSince(seq: number): (LoggedEvent | UnreadableLogEntry)[];
}
