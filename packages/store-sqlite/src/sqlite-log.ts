import type { DatabaseSync } from "node:sqlite";
import { encounterEventSchema } from "@ttrpg-agents/engine";
import type {
  EncounterLog,
  LoggedEvent,
  UnreadableLogEntry,
} from "@ttrpg-agents/engine";

interface EventRow {
  seq: number;
  event: string;
}

/** Reads the encounter change log that the repository writes in its mutation transactions. */
export class SqliteEncounterLog implements EncounterLog {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  latestSeq(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM encounter_events")
      .get() as { seq: number };
    return row.seq;
  }

  eventsSince(seq: number): (LoggedEvent | UnreadableLogEntry)[] {
    const rows = this.db
      .prepare(
        "SELECT seq, event FROM encounter_events WHERE seq > ? ORDER BY seq",
      )
      .all(seq) as unknown as EventRow[];
    return rows.map((row): LoggedEvent | UnreadableLogEntry => {
      try {
        return {
          seq: row.seq,
          event: encounterEventSchema.parse(JSON.parse(row.event)),
        };
      } catch (e) {
        return {
          seq: row.seq,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
  }
}
