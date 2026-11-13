import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterDirectory } from "./sqlite-directory.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

let db: DatabaseSync;
let times: number[];
let directory: SqliteEncounterDirectory;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  times = [];
  let t = 1000;
  directory = new SqliteEncounterDirectory(db, {
    newId: () => `id-${String(++n)}`,
    now: () => times.shift() ?? ++t,
  });
});

const ogre = (displayName: string) => ({
  monsterKey: "ogre",
  displayName,
  maxHp: 59,
});

describe("SqliteEncounterDirectory", () => {
  it("createEncounter stores a named encounter that is not current, and listEncounters lists every encounter oldest first", () => {
    times = [300, 100, 100];
    const late = directory.createEncounter("Encounter 1");
    const early = directory.createEncounter("Bridge fight");
    const sameTime = directory.createEncounter("Encounter 2");

    expect(late).toEqual({ id: late.id, name: "Encounter 1", createdAt: 300 });
    expect(early).toEqual({
      id: early.id,
      name: "Bridge fight",
      createdAt: 100,
    });
    expect(new Set([late.id, early.id, sameTime.id]).size).toBe(3);
    expect(directory.getCurrentEncounter()).toBeUndefined();
    expect(directory.listEncounters()).toEqual([early, sameTime, late]);
  });

  it("createEncounter refuses a name another encounter has, ignoring case, and stores nothing", () => {
    const first = directory.createEncounter("Encounter 1");

    expect(() => directory.createEncounter("encounter 1")).toThrow();
    expect(() => directory.createEncounter("ENCOUNTER 1")).toThrow();

    expect(directory.listEncounters()).toEqual([first]);
  });

  it("getCurrentEncounter returns undefined on an empty store and the current encounter once one is set, without creating one", () => {
    expect(directory.getCurrentEncounter()).toBeUndefined();
    expect(directory.listEncounters()).toEqual([]);

    const encounter = directory.createEncounter("Encounter 1");
    expect(directory.getCurrentEncounter()).toBeUndefined();

    directory.setCurrentEncounter(encounter.id);
    expect(directory.getCurrentEncounter()).toEqual(encounter);
    expect(directory.listEncounters()).toEqual([encounter]);
  });

  it("setCurrentEncounter makes that encounter current and the previous one not, and throws for an unknown id changing nothing", () => {
    const a = directory.createEncounter("Encounter 1");
    const b = directory.createEncounter("Encounter 2");

    directory.setCurrentEncounter(a.id);
    expect(directory.getCurrentEncounter()).toEqual(a);
    directory.setCurrentEncounter(b.id);
    expect(directory.getCurrentEncounter()).toEqual(b);
    expect(
      db.prepare("SELECT id FROM encounters WHERE active = 1").all(),
    ).toEqual([{ id: b.id }]);

    expect(() => directory.setCurrentEncounter("no-such-encounter")).toThrow();
    expect(directory.getCurrentEncounter()).toEqual(b);
    expect(directory.listEncounters()).toEqual([a, b]);
  });

  it("findEncounterOfInstance returns the encounter holding a live or removed instance, and undefined for an unknown id", () => {
    const a = directory.createEncounter("Encounter 1");
    const b = directory.createEncounter("Encounter 2");
    directory.setCurrentEncounter(a.id);
    const [inA] = directory
      .repositoryFor(a.id)
      .addInstances(() => [ogre("Ogre 1")], origin);
    const repoB = directory.repositoryFor(b.id);
    const [liveInB, removedInB] = repoB.addInstances(
      () => [ogre("Ogre 1"), ogre("Ogre 2")],
      origin,
    );
    repoB.removeInstances([removedInB!.id], origin);

    expect(directory.findEncounterOfInstance(inA!.id)).toEqual(a);
    expect(directory.findEncounterOfInstance(liveInB!.id)).toEqual(b);
    expect(directory.findEncounterOfInstance(removedInB!.id)).toEqual(b);
    expect(
      directory.findEncounterOfInstance("no-such-instance"),
    ).toBeUndefined();
  });

  it("allows only one active encounter at the database level", () => {
    const encounter = directory.createEncounter("Encounter 1");
    directory.setCurrentEncounter(encounter.id);
    expect(() =>
      db
        .prepare(
          "INSERT INTO encounters (id, name, active, created_at) VALUES ('x', 'Encounter 2', 1, 0)",
        )
        .run(),
    ).toThrow();
  });
});
