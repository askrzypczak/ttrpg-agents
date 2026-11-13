import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openScene, type ChangeOrigin } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterDirectory } from "./sqlite-directory.js";
import { SqliteEncounterLog } from "./sqlite-log.js";

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

describe("SqliteEncounterDirectory scenes", () => {
  it("getOpenScene returns undefined when no scene is open, the open scene with no encounter when it is unbound, and undefined again after setOpenScene(null)", () => {
    directory.createEncounter("Encounter 1");
    expect(directory.getOpenScene()).toBeUndefined();

    directory.setOpenScene("scene-1");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });

    directory.setOpenScene(null);
    expect(directory.getOpenScene()).toBeUndefined();
  });

  it("bindScene binds a scene to an encounter, and getOpenScene returns the open scene with that encounter", () => {
    directory.createEncounter("Encounter 1");
    const bound = directory.createEncounter("Encounter 2");

    directory.bindScene("scene-1", bound.id);
    directory.setOpenScene("scene-1");

    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: bound,
    });
    directory.setOpenScene("scene-2");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-2",
      encounter: undefined,
    });
  });

  it("bindScene refuses a second encounter for a bound scene and a second scene for a bound encounter, and changes nothing", () => {
    const a = directory.createEncounter("Encounter 1");
    const b = directory.createEncounter("Encounter 2");
    directory.bindScene("scene-1", a.id);

    expect(() => directory.bindScene("scene-1", b.id)).toThrow();
    expect(() => directory.bindScene("scene-2", a.id)).toThrow();
    expect(() => directory.bindScene("scene-3", "no-such-encounter")).toThrow();

    directory.setOpenScene("scene-1");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: a,
    });
    directory.setOpenScene("scene-2");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-2",
      encounter: undefined,
    });
    directory.setOpenScene("scene-3");
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-3",
      encounter: undefined,
    });
    // Encounter 2 is still free to bind.
    directory.bindScene("scene-2", b.id);
    directory.setOpenScene("scene-2");
    expect(directory.getOpenScene()?.encounter).toEqual(b);
    expect(directory.listEncounters()).toEqual([a, b]);
  });

  it("openScene over the SQLite directory changes no instance and adds no change-log row", () => {
    const bound = directory.createEncounter("Encounter 1");
    const current = directory.createEncounter("Encounter 2");
    const repo = directory.repositoryFor(bound.id);
    repo.addInstances(() => [ogre("Ogre 1"), ogre("Ogre 2")], origin);
    directory.bindScene("scene-1", bound.id);
    directory.setCurrentEncounter(current.id);
    const log = new SqliteEncounterLog(db);
    const instancesBefore = repo.listInstances();
    const seqBefore = log.latestSeq();

    openScene(directory, "scene-1");

    expect(directory.getCurrentEncounter()).toEqual(bound);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: bound,
    });
    expect(directory.repositoryFor(bound.id).listInstances()).toEqual(
      instancesBefore,
    );
    expect(log.latestSeq()).toBe(seqBefore);
  });
});

describe("SqliteEncounterDirectory inside an outer transaction", () => {
  it("setCurrentEncounter with an unknown id inside an outer transaction changes nothing when the caller catches the throw", () => {
    const a = directory.createEncounter("Encounter 1");
    directory.setCurrentEncounter(a.id);

    directory.transaction(() => {
      try {
        directory.setCurrentEncounter("missing");
      } catch {
        // The caller carries on with the transaction.
      }
    });

    expect(directory.getCurrentEncounter()).toEqual(a);
  });
});
