import type { DatabaseSync } from "node:sqlite";
import type { MapRegistration, MapRepository } from "@ttrpg-agents/engine";

/** Registered maps and the active one, in the `map_registrations` table of the shared database. */
export class SqliteMapRepository implements MapRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  registerMap(registration: MapRegistration): void {
    void this.db;
    void registration;
    throw new Error("not implemented");
  }

  getActiveMap(): MapRegistration | undefined {
    void this.db;
    throw new Error("not implemented");
  }
}
