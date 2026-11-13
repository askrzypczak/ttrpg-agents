import { describe, expect, it } from "vitest";
import {
  nextEncounterName,
  openScene,
  repositoryForInstance,
  resolveEncounter,
  type EncounterDirectory,
  type OpenScene,
} from "./directory.js";
import {
  NoSceneEncounterError,
  UnknownEncounterError,
  UnknownInstanceError,
} from "./errors.js";
import type { MapRepository } from "../map/repository.js";
import type { EncounterRepository } from "./repository.js";
import type { Encounter } from "./types.js";

/** An in-memory directory that records which calls ran inside a transaction. */
class FakeDirectory implements EncounterDirectory {
  readonly encounters: Encounter[] = [];
  currentId: string | undefined;
  /** The open scene's id, or undefined when none is open. */
  openSceneId: string | undefined;
  /** Scene id -> id of the encounter bound to it. */
  readonly bindings = new Map<string, string>();
  /** Instance id -> id of the encounter holding it. */
  readonly holders = new Map<string, string>();
  readonly repositories = new Map<string, EncounterRepository>();
  /** Each mutating call, with whether it ran inside a transaction. */
  readonly writes: { call: string; inTransaction: boolean }[] = [];
  transactions = 0;
  /** How many times a repository (encounter or map) was asked for. */
  repositoryRequests = 0;
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

  getOpenScene(): OpenScene | undefined {
    if (this.openSceneId === undefined) return undefined;
    const boundId = this.bindings.get(this.openSceneId);
    return {
      sceneId: this.openSceneId,
      encounter: this.encounters.find((e) => e.id === boundId),
    };
  }

  setOpenScene(sceneId: string | null): void {
    this.writes.push({ call: "setOpenScene", inTransaction: this.depth > 0 });
    this.openSceneId = sceneId ?? undefined;
  }

  bindScene(sceneId: string, encounterId: string): void {
    this.writes.push({ call: "bindScene", inTransaction: this.depth > 0 });
    if (this.bindings.has(sceneId))
      throw new Error(`scene already bound: ${sceneId}`);
    if ([...this.bindings.values()].includes(encounterId))
      throw new Error(`encounter already bound: ${encounterId}`);
    if (!this.encounters.some((e) => e.id === encounterId))
      throw new Error(`unknown encounter: ${encounterId}`);
    this.bindings.set(sceneId, encounterId);
  }

  findEncounterOfInstance(instanceId: string): Encounter | undefined {
    const id = this.holders.get(instanceId);
    return this.encounters.find((e) => e.id === id);
  }

  repositoryFor(encounterId: string): EncounterRepository {
    this.repositoryRequests++;
    const repo = this.repositories.get(encounterId);
    if (!repo) throw new Error(`unknown encounter: ${encounterId}`);
    return repo;
  }

  mapRepositoryFor(): MapRepository {
    this.repositoryRequests++;
    throw new Error("not used by these tests");
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
  it("resolveEncounter with a name returns that encounter, matched ignoring case, as not created", () => {
    const directory = new FakeDirectory();
    directory.add("Encounter 1");
    const named = directory.add("Bridge fight");
    directory.currentId = named.id;

    expect(
      resolveEncounter(directory, { name: "bridge FIGHT", writes: true }),
    ).toEqual({ encounter: named, created: false });
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter with a name and no scene open makes that encounter current", () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    const named = directory.add("Bridge fight");
    directory.currentId = current.id;

    const resolved = resolveEncounter(directory, {
      name: "Bridge fight",
      writes: false,
    });

    expect(resolved).toEqual({ encounter: named, created: false });
    expect(directory.getCurrentEncounter()).toEqual(named);
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.writes.map((w) => w.call)).toEqual([
      "setCurrentEncounter",
    ]);
  });

  it("resolveEncounter with a name while a scene is open leaves the current encounter as it was", () => {
    const directory = new FakeDirectory();
    const bound = directory.add("Encounter 1");
    const current = directory.add("Encounter 2");
    const named = directory.add("Bridge fight");
    directory.bindings.set("scene-1", bound.id);
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    const resolved = resolveEncounter(directory, {
      name: "bridge fight",
      writes: true,
    });

    expect(resolved).toEqual({ encounter: named, created: false });
    expect(directory.currentId).toBe(current.id);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter with an unknown name throws UnknownEncounterError listing the encounters' names, and writes nothing", () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    directory.add("Bridge fight");
    directory.currentId = current.id;

    const resolve = () =>
      resolveEncounter(directory, { name: "Goblins", writes: true });

    expect(resolve).toThrow(UnknownEncounterError);
    expect(resolve).toThrow(
      'Unknown encounter "Goblins"; known encounters: Encounter 1, Bridge fight.',
    );
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.currentId).toBe(current.id);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter with an unknown name and no encounters throws UnknownEncounterError saying there are none", () => {
    const directory = new FakeDirectory();

    const resolve = () =>
      resolveEncounter(directory, { name: "Goblins", writes: true });

    expect(resolve).toThrow(UnknownEncounterError);
    expect(resolve).toThrow(
      'Unknown encounter "Goblins"; there are no encounters.',
    );
    expect(directory.listEncounters()).toEqual([]);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter in an open bound scene returns its encounter as not created, even when another encounter is current, and writes nothing", () => {
    const directory = new FakeDirectory();
    const bound = directory.add("Encounter 1");
    const current = directory.add("Encounter 2");
    directory.bindings.set("scene-1", bound.id);
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    expect(resolveEncounter(directory, { writes: true })).toEqual({
      encounter: bound,
      created: false,
    });
    expect(resolveEncounter(directory, { writes: false })).toEqual({
      encounter: bound,
      created: false,
    });
    expect(directory.currentId).toBe(current.id);
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.writes).toEqual([]);
  });

  it('resolveEncounter for a write in an open unbound scene creates the next free "Encounter N", binds it to the scene and makes it current in one transaction, and returns it as created', () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    directory.add("encounter 3");
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    const resolved = resolveEncounter(directory, { writes: true });

    expect(resolved.created).toBe(true);
    expect(resolved.encounter.name).toBe("Encounter 2");
    expect(directory.listEncounters().map((e) => e.name)).toEqual([
      "Encounter 1",
      "encounter 3",
      "Encounter 2",
    ]);
    expect(directory.bindings.get("scene-1")).toBe(resolved.encounter.id);
    expect(directory.getCurrentEncounter()).toEqual(resolved.encounter);
    expect(directory.transactions).toBe(1);
    expect(directory.writes.map((w) => w.call).sort()).toEqual([
      "bindScene",
      "createEncounter",
      "setCurrentEncounter",
    ]);
    expect(directory.writes.every((w) => w.inTransaction)).toBe(true);
  });

  it("resolveEncounter for two writes back to back in an open unbound scene creates one encounter, and the second returns it as not created", () => {
    const directory = new FakeDirectory();
    directory.openSceneId = "scene-1";

    const first = resolveEncounter(directory, { writes: true });
    const second = resolveEncounter(directory, { writes: true });

    expect(first.created).toBe(true);
    expect(second).toEqual({ encounter: first.encounter, created: false });
    expect(directory.listEncounters()).toEqual([first.encounter]);
    expect(directory.bindings.get("scene-1")).toBe(first.encounter.id);
    expect(directory.writes.map((w) => w.call).sort()).toEqual([
      "bindScene",
      "createEncounter",
      "setCurrentEncounter",
    ]);
  });

  it("resolveEncounter for a write returns the encounter another process bound to the open scene after its first read, and creates none", () => {
    const directory = new FakeDirectory();
    const other = directory.add("Encounter 1");
    directory.openSceneId = "scene-1";
    const transaction = directory.transaction.bind(directory);
    // Another process binds the open scene between the first read and the
    // write lock.
    directory.transaction = <T>(fn: () => T): T =>
      transaction(() => {
        directory.bindings.set("scene-1", other.id);
        return fn();
      });

    const resolved = resolveEncounter(directory, { writes: true });

    expect(resolved).toEqual({ encounter: other, created: false });
    expect(directory.listEncounters()).toEqual([other]);
    expect(directory.writes).toEqual([]);
  });

  it('resolveEncounter for a read in an open unbound scene throws NoSceneEncounterError "This scene has no encounter yet." and writes nothing', () => {
    const directory = new FakeDirectory();
    const current = directory.add("Encounter 1");
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    const resolve = () => resolveEncounter(directory, { writes: false });

    expect(resolve).toThrow(NoSceneEncounterError);
    expect(resolve).toThrow("This scene has no encounter yet.");
    expect(directory.listEncounters()).toEqual([current]);
    expect(directory.bindings.size).toBe(0);
    expect(directory.currentId).toBe(current.id);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter with no scene open returns the current encounter as not created and writes nothing", () => {
    const directory = new FakeDirectory();
    directory.add("Encounter 1");
    const current = directory.add("Bridge fight");
    directory.currentId = current.id;

    expect(resolveEncounter(directory, { writes: true })).toEqual({
      encounter: current,
      created: false,
    });
    expect(resolveEncounter(directory, { writes: false })).toEqual({
      encounter: current,
      created: false,
    });
    expect(directory.listEncounters()).toHaveLength(2);
    expect(directory.writes).toEqual([]);
    expect(directory.currentId).toBe(current.id);
  });

  it('resolveEncounter with no scene open and no current encounter creates the next free "Encounter N" in one transaction, makes it current and returns it as created', () => {
    const directory = new FakeDirectory();
    directory.add("Encounter 1");
    directory.add("encounter 3");

    const resolved = resolveEncounter(directory, { writes: true });

    expect(resolved.created).toBe(true);
    expect(resolved.encounter.name).toBe("Encounter 2");
    expect(directory.listEncounters().map((e) => e.name)).toEqual([
      "Encounter 1",
      "encounter 3",
      "Encounter 2",
    ]);
    expect(directory.getCurrentEncounter()).toEqual(resolved.encounter);
    expect(directory.transactions).toBe(1);
    expect(directory.writes).toEqual([
      { call: "createEncounter", inTransaction: true },
      { call: "setCurrentEncounter", inTransaction: true },
    ]);
  });

  it("resolveEncounter for a read with no scene open and no current encounter creates one as a write does", () => {
    const directory = new FakeDirectory();

    const resolved = resolveEncounter(directory, { writes: false });

    expect(resolved.created).toBe(true);
    expect(resolved.encounter.name).toBe("Encounter 1");
    expect(directory.listEncounters()).toEqual([resolved.encounter]);
    expect(directory.getCurrentEncounter()).toEqual(resolved.encounter);
    expect(directory.transactions).toBe(1);
    expect(directory.writes).toEqual([
      { call: "createEncounter", inTransaction: true },
      { call: "setCurrentEncounter", inTransaction: true },
    ]);
  });

  it("resolveEncounter with no scene open returns the encounter another process made current after its first read, and creates none", () => {
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

    const resolved = resolveEncounter(directory, { writes: true });

    expect(resolved).toEqual({ encounter: other, created: false });
    expect(directory.listEncounters()).toEqual([other]);
    expect(directory.writes).toEqual([]);
  });

  it("resolveEncounter for a read throws NoSceneEncounterError when another process opens an unbound scene after its first read, and creates none", () => {
    const directory = new FakeDirectory();
    const transaction = directory.transaction.bind(directory);
    // Another process opens a scene with no encounter between the first read
    // and the write lock.
    directory.transaction = <T>(fn: () => T): T =>
      transaction(() => {
        directory.openSceneId = "scene-1";
        return fn();
      });

    expect(() => resolveEncounter(directory, { writes: false })).toThrow(
      NoSceneEncounterError,
    );
    expect(directory.listEncounters()).toEqual([]);
    expect(directory.bindings.size).toBe(0);
    expect(directory.writes).toEqual([]);
  });
});

describe("openScene", () => {
  it("openScene on a bound scene records it as open and makes its encounter current in one transaction, and asks for no repository", () => {
    const directory = new FakeDirectory();
    const bound = directory.add("Encounter 1");
    const current = directory.add("Encounter 2");
    directory.bindings.set("scene-1", bound.id);
    directory.currentId = current.id;

    openScene(directory, "scene-1");

    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: bound,
    });
    expect(directory.getCurrentEncounter()).toEqual(bound);
    expect(directory.transactions).toBe(1);
    expect(directory.writes).toEqual([
      { call: "setOpenScene", inTransaction: true },
      { call: "setCurrentEncounter", inTransaction: true },
    ]);
    expect(directory.repositoryRequests).toBe(0);
    expect(directory.listEncounters()).toHaveLength(2);
  });

  it("openScene on an unbound scene records it as open, binds nothing and leaves the current encounter as it was", () => {
    const directory = new FakeDirectory();
    const bound = directory.add("Encounter 1");
    const current = directory.add("Encounter 2");
    directory.bindings.set("scene-1", bound.id);
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    openScene(directory, "scene-2");

    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-2",
      encounter: undefined,
    });
    expect([...directory.bindings]).toEqual([["scene-1", bound.id]]);
    expect(directory.currentId).toBe(current.id);
    expect(directory.writes.map((w) => w.call)).toEqual(["setOpenScene"]);
    expect(directory.listEncounters()).toHaveLength(2);
  });

  it("openScene with null records that no scene is open and leaves the current encounter as it was", () => {
    const directory = new FakeDirectory();
    const bound = directory.add("Encounter 1");
    const current = directory.add("Encounter 2");
    directory.bindings.set("scene-1", bound.id);
    directory.openSceneId = "scene-1";
    directory.currentId = current.id;

    openScene(directory, null);

    expect(directory.getOpenScene()).toBeUndefined();
    expect([...directory.bindings]).toEqual([["scene-1", bound.id]]);
    expect(directory.currentId).toBe(current.id);
    expect(directory.writes.map((w) => w.call)).toEqual(["setOpenScene"]);
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
