import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  UnknownInstanceError,
  type ChangeOrigin,
  type EncounterEvent,
  type LoggedEvent,
  type MonsterInstance,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "move-1" };
const setupOrigin: ChangeOrigin = { source: "mcp", commandId: "setup" };

let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let log: SqliteEncounterLog;
let first: MonsterInstance;
let second: MonsterInstance;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  log = new SqliteEncounterLog(db);
  [first, second] = repo.addInstances(
    () => [
      {
        monsterKey: "wolf",
        displayName: "Wolf 1",
        maxHp: 11,
        initiative: 14,
        spawnPosition: { x: 250, y: 150 },
      },
      {
        monsterKey: "wolf",
        displayName: "Wolf 2",
        maxHp: 11,
        initiative: 9,
      },
    ],
    setupOrigin,
  ) as [MonsterInstance, MonsterInstance];
  repo.applyDamage(first.id, 4, setupOrigin);
});

const isEvent = (
  entry: LoggedEvent | UnreadableLogEntry,
): entry is LoggedEvent => "event" in entry;

const eventsAfter = (seq: number): EncounterEvent[] =>
  log
    .eventsSince(seq)
    .filter(isEvent)
    .map((logged) => logged.event);

const byId = (id: string): MonsterInstance | undefined =>
  repo.listInstances().find((i) => i.id === id);

/** Every field of the instance but its spawn position. */
const withoutSpawn = (
  instance: MonsterInstance,
): Omit<MonsterInstance, "spawnPosition"> => {
  const rest: Partial<MonsterInstance> = { ...instance };
  delete rest.spawnPosition;
  return rest as Omit<MonsterInstance, "spawnPosition">;
};

describe("setSpawnPositions", () => {
  it("setSpawnPositions stores each instance's new spawn position and returns the instances updated", () => {
    const updated = repo.setSpawnPositions(
      [
        { id: second.id, spawnPosition: { x: 650, y: 550 } },
        { id: first.id, spawnPosition: { x: 350, y: 150 } },
      ],
      origin,
    );

    expect(updated.map((i) => [i.id, i.spawnPosition])).toEqual([
      [second.id, { x: 650, y: 550 }],
      [first.id, { x: 350, y: 150 }],
    ]);
    expect(byId(first.id)?.spawnPosition).toEqual({ x: 350, y: 150 });
    expect(byId(second.id)?.spawnPosition).toEqual({ x: 650, y: 550 });
  });

  it("setSpawnPositions keeps each instance's id, HP, initiative and name", () => {
    const before = repo.listInstances();

    repo.setSpawnPositions(
      [
        { id: first.id, spawnPosition: { x: 350, y: 150 } },
        { id: second.id, spawnPosition: { x: 650, y: 550 } },
      ],
      origin,
    );

    const after = repo.listInstances();
    expect(after.map((i) => i.spawnPosition)).toEqual([
      { x: 350, y: 150 },
      { x: 650, y: 550 },
    ]);
    expect(after.map(withoutSpawn)).toEqual(before.map(withoutSpawn));
    expect(
      after.map((i) => [
        i.id,
        i.displayName,
        i.currentHp,
        i.maxHp,
        i.initiative,
      ]),
    ).toEqual([
      [first.id, "Wolf 1", 7, 11, 14],
      [second.id, "Wolf 2", 11, 11, 9],
    ]);
  });

  it("setSpawnPositions appends one position-changed event per instance with the origin", () => {
    const seq = log.latestSeq();

    repo.setSpawnPositions(
      [
        { id: first.id, spawnPosition: { x: 350, y: 150 } },
        { id: second.id, spawnPosition: { x: 650, y: 550 } },
      ],
      origin,
    );

    expect(eventsAfter(seq)).toEqual([
      {
        type: "position-changed",
        id: first.id,
        spawnPosition: { x: 350, y: 150 },
        origin,
      },
      {
        type: "position-changed",
        id: second.id,
        spawnPosition: { x: 650, y: 550 },
        origin,
      },
    ]);
  });

  it("setSpawnPositions changes nothing and throws UnknownInstanceError when an id is not in the active encounter", () => {
    const before = repo.listInstances();
    const seq = log.latestSeq();

    expect(() =>
      repo.setSpawnPositions(
        [
          { id: first.id, spawnPosition: { x: 350, y: 150 } },
          { id: "missing", spawnPosition: { x: 650, y: 550 } },
        ],
        origin,
      ),
    ).toThrow(UnknownInstanceError);

    expect(repo.listInstances()).toEqual(before);
    expect(eventsAfter(seq)).toEqual([]);
  });
});
