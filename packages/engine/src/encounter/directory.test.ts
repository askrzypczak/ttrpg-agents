import { describe, expect, it } from "vitest";
import {
  nextEncounterName,
  repositoryForInstance,
  resolveEncounter,
  type EncounterDirectory,
} from "./directory.js";
import { UnknownInstanceError } from "./errors.js";
import type { EncounterRepository } from "./repository.js";
import type { Encounter } from "./types.js";

/** An in-memory directory that records which calls ran inside a transaction. */
class FakeDirectory implements EncounterDirectory {
  readonly encounters: Encounter[] = [];
  currentId: string | undefined;
  /** Instance id -> id of the encounter holding it. */
  readonly holders = new Map<string, string>();
  readonly repositories = new Map<string, EncounterRepository>();
  /** Each mutating call, with whether it ran inside a transaction. */
  readonly writes: { call: string; inTransaction: boolean }[] = [];
  transactions = 0;
  private depth = 0;
  private nextId = 1;

  add(name: string): Encounter {
    const encounter = {
      id: `enc-${String(this.nextId++)}`,
      name,
      createdAt: this.nextId,
    };
    this.encounters.push(encounter);
    this.repositories.set(encounter.id, {
      tag: encounter.id,
    } as unknown as EncounterRepository);
    return encounter;
  }

  listEncounters(): Encounter[] {
    return [...this.encounters];
  }

  createEncounter(name: string): Encounter {
    this.writes.push({
      call: "createEncounter",
      inTransaction: this.depth > 0,
    });
    if (
      this.encounters.some((e) => e.name.toLowerCase() === name.toLowerCase())
    )
      throw new Error(`name taken: ${name}`);
    return this.add(name);
  }

  getCurrentEncounter(): Encounter | undefined {
    return this.encounters.find((e) => e.id === this.currentId);
  }

  setCurrentEncounter(id: string): void {
    this.writes.push({
      call: "setCurrentEncounter",
      inTransaction: this.depth > 0,
    });
    if (!this.encounters.some((e) => e.id === id))
      throw new Error(`unknown encounter: ${id}`);
    this.currentId = id;
  }

  findEncounterOfInstance(instanceId: string): Encounter | undefined {
    const id = this.holders.get(instanceId);
    return this.encounters.find((e) => e.id === id);
  }

  repositoryFor(encounterId: string): EncounterRepository {
    const repo = this.repositories.get(encounterId);
    if (!repo) throw new Error(`unknown encounter: ${encounterId}`);
    return repo;
  }

  transaction<T>(fn: () => T): T {
    this.transactions++;
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }
}

describe("nextEncounterName", () => {
  it('nextEncounterName returns "Encounter 1" when no name is taken', () => {
    expect(nextEncounterName([])).toBe("Encounter 1");
    expect(nextEncounterName(["Goblin ambush"])).toBe("Encounter 1");
  });

  it('nextEncounterName returns the lowest "Encounter N" that no name takes, ignoring case', () => {
    expect(nextEncounterName(["Encounter 1"])).toBe("Encounter 2");
    expect(
      nextEncounterName(["encounter 1", "ENCOUNTER 2", "Encounter 4"]),
    ).toBe("Encounter 3");
    expect(nextEncounterName(["Encounter 2", "Encounter 3"])).toBe(
      "Encounter 1",
    );
  });
});

describe("resolveEncounter", () => {
  it("resolveEncounter returns the current encounter and creates none", () => {
    const directory = new FakeDirectory();
    directory.add("Encounter 1");
    const current = directory.add("Bridge fight");
    directory.currentId = current.id;

    expect(resolveEncounter(directory)).toEqual(current);
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.writes).toEqual([]);
    expect(directory.currentId).toBe(current.id);
  });

  it('resolveEncounter with no current encounter creates the next free "Encounter N" in one transaction and makes it current', () => {
    const directory = new FakeDirectory();
    directory.add("Encounter 1");
    directory.add("encounter 3");

    const resolved = resolveEncounter(directory);

    expect(resolved.name).toBe("Encounter 2");
    expect(directory.listEncounters().map((e) => e.name)).toEqual([
      "Encounter 1",
      "encounter 3",
      "Encounter 2",
    ]);
    expect(directory.getCurrentEncounter()).toEqual(resolved);
    expect(directory.transactions).toBe(1);
    expect(directory.writes).toEqual([
      { call: "createEncounter", inTransaction: true },
      { call: "setCurrentEncounter", inTransaction: true },
    ]);
  });

  it("resolveEncounter returns the encounter another process made current after its first read, and creates none", () => {
    const directory = new FakeDirectory();
    const other = directory.add("Encounter 1");
    const transaction = directory.transaction.bind(directory);
    // Another process makes an encounter current between the first read and
    // the write lock.
    directory.transaction = <T>(fn: () => T): T =>
      transaction(() => {
        directory.currentId = other.id;
        return fn();
      });

    const resolved = resolveEncounter(directory);

    expect(resolved).toEqual(other);
    expect(directory.listEncounters()).toEqual([other]);
    expect(directory.writes).toEqual([]);
  });
});

describe("repositoryForInstance", () => {
  it("repositoryForInstance returns the repository of the encounter that holds the instance", () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    const holder = directory.add("Encounter 2");
    directory.currentId = current.id;
    directory.holders.set("wolf-1", holder.id);

    expect(repositoryForInstance(directory, "wolf-1")).toBe(
      directory.repositoryFor(holder.id),
    );
  });

  it("repositoryForInstance throws UnknownInstanceError when no encounter holds the instance", () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    directory.currentId = current.id;
    directory.holders.set("wolf-1", current.id);

    expect(() => repositoryForInstance(directory, "ghost")).toThrow(
      UnknownInstanceError,
    );
  });
});
