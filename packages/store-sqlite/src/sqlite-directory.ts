import type { DatabaseSync } from "node:sqlite";
import type {
  Encounter,
  EncounterDirectory,
  EncounterRepository,
} from "@ttrpg-agents/engine";
import type { RepositoryOptions } from "./sqlite-repository.js";

/** The encounters of one database, the current one, and repositories scoped to one. */
export class SqliteEncounterDirectory implements EncounterDirectory {
  private readonly db: DatabaseSync;
  private readonly options: RepositoryOptions;

  constructor(db: DatabaseSync, options: RepositoryOptions = {}) {
    this.db = db;
    this.options = options;
  }

  listEncounters(): Encounter[] {
    throw new Error("not implemented");
  }

  createEncounter(name: string): Encounter {
    void name;
    throw new Error("not implemented");
  }

  getCurrentEncounter(): Encounter | undefined {
    throw new Error("not implemented");
  }

  setCurrentEncounter(id: string): void {
    void id;
    throw new Error("not implemented");
  }

  findEncounterOfInstance(instanceId: string): Encounter | undefined {
    void instanceId;
    throw new Error("not implemented");
  }

  repositoryFor(encounterId: string): EncounterRepository {
    void encounterId;
    void this.db;
    void this.options;
    throw new Error("not implemented");
  }

  transaction<T>(fn: () => T): T {
    void fn;
    throw new Error("not implemented");
  }
}
