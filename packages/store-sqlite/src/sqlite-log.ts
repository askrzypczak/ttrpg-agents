import type { DatabaseSync } from "node:sqlite";
import type { EncounterLog, LoggedEvent } from "@ttrpg-agents/engine";

export class SqliteEncounterLog implements EncounterLog {
  constructor(db: DatabaseSync) {
    void db;
  }

  latestSeq(): number {
    throw new Error("not implemented");
  }

  eventsSince(seq: number): LoggedEvent[] {
    void seq;
    throw new Error("not implemented");
  }
}
