import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Encounter,
  EncounterDirectory,
  EncounterRepository,
  MapRepository,
  OpenScene,
} from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  type RepositoryOptions,
} from "./sqlite-repository.js";
import { SqliteMapRepository } from "./map-repository.js";

interface EncounterRow {
  id: string;
  name: string;
  created_at: number;
}

function toEncounter(row: EncounterRow): Encounter {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** The encounters of one database, the current one, and repositories scoped to one. */
export class SqliteEncounterDirectory implements EncounterDirectory {
  private readonly db: DatabaseSync;
  private readonly options: RepositoryOptions;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(db: DatabaseSync, options: RepositoryOptions = {}) {
    this.db = db;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  listEncounters(): Encounter[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, created_at FROM encounters ORDER BY created_at, rowid",
      )
      .all() as unknown as EncounterRow[];
    return rows.map(toEncounter);
  }

  createEncounter(name: string): Encounter {
    const encounter: Encounter = {
      id: this.newId(),
      name,
      createdAt: this.now(),
    };
    this.db
      .prepare(
        "INSERT INTO encounters (id, name, active, created_at) VALUES (?, ?, 0, ?)",
      )
      .run(encounter.id, encounter.name, encounter.createdAt);
    return encounter;
  }

  getCurrentEncounter(): Encounter | undefined {
    const row = this.db
      .prepare("SELECT id, name, created_at FROM encounters WHERE active = 1")
      .get() as EncounterRow | undefined;
    return row ? toEncounter(row) : undefined;
  }

  setCurrentEncounter(id: string): void {
    this.transaction(() => {
      // Checked before any write, so a caller that catches the throw inside
      // an outer transaction keeps the current encounter it had.
      const known = this.db
        .prepare("SELECT 1 FROM encounters WHERE id = ?")
        .get(id);
      if (!known) throw new Error(`Unknown encounter: ${id}`);
      this.db
        .prepare("UPDATE encounters SET active = 0 WHERE active = 1")
        .run();
      this.db.prepare("UPDATE encounters SET active = 1 WHERE id = ?").run(id);
    });
  }

  findEncounterOfInstance(instanceId: string): Encounter | undefined {
    const row = this.db
      .prepare(
        `SELECT e.id, e.name, e.created_at FROM encounters e
         JOIN monster_instances m ON m.encounter_id = e.id
         WHERE m.id = ?`,
      )
      .get(instanceId) as EncounterRow | undefined;
    return row ? toEncounter(row) : undefined;
  }

  repositoryFor(encounterId: string): EncounterRepository {
    return new SqliteEncounterRepository(this.db, encounterId, this.options);
  }

  mapRepositoryFor(encounterId: string): MapRepository {
    return new SqliteMapRepository(this.db, encounterId);
  }

  getOpenScene(): OpenScene | undefined {
    throw new Error("not implemented");
  }

  setOpenScene(sceneId: string | null): void {
    void sceneId;
    throw new Error("not implemented");
  }

  bindScene(sceneId: string, encounterId: string): void {
    void sceneId;
    void encounterId;
    throw new Error("not implemented");
  }

  /** Runs fn in a transaction; nests by joining an already-open one. */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
