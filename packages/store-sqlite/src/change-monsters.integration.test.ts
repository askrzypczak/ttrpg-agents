import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  InvalidNameError,
  UnknownInstanceError,
  type ChangeOrigin,
  type EncounterEvent,
  type LoggedEvent,
  type MonsterChange,
  type MonsterInstance,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "change-1" };
const setupOrigin: ChangeOrigin = { source: "mcp", commandId: "setup" };

let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let log: SqliteEncounterLog;
let first: MonsterInstance;
let second: MonsterInstance;
let third: MonsterInstance;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  log = new SqliteEncounterLog(db);
  [first, second, third] = repo.addInstances(
    () => [
      {
        monsterKey: "wolf",
        displayName: "Wolf 1",
        maxHp: 11,
        armorClass: 13,
        initiative: 15,
        groupId: "g1",
        statsVisible: true,
        spawnPosition: { x: 250, y: 150 },
      },
      {
        monsterKey: "wolf",
        displayName: "Wolf 2",
        maxHp: 11,
        armorClass: 13,
        initiative: null,
        groupId: "g1",
      },
      {
        monsterKey: "goblin",
        displayName: "Goblin 1",
        maxHp: 7,
        armorClass: 15,
        initiative: 12,
        groupId: "g2",
      },
    ],
    setupOrigin,
  ) as [MonsterInstance, MonsterInstance, MonsterInstance];
  repo.applyDamage(first.id, 6, setupOrigin);
  first = byId(first.id)!;
});

const isEvent = (
  entry: LoggedEvent | UnreadableLogEntry,
): entry is LoggedEvent => "event" in entry;

const eventsAfter = (seq: number): EncounterEvent[] =>
  log
    .eventsSince(seq)
    .filter(isEvent)
    .map((logged) => logged.event);

function byId(id: string): MonsterInstance | undefined {
  return repo.listInstances().find((i) => i.id === id);
}

function toDireWolf(
  id: string,
  displayName: string,
  over: Partial<MonsterChange> = {},
): MonsterChange {
  return {
    id,
    monsterKey: "dire-wolf",
    displayName,
    maxHp: 37,
    currentHp: 31,
    armorClass: 14,
    initiative: 14,
    footprint: 2,
    ...over,
  };
}

describe("changeMonsters", () => {
  it("changeMonsters writes each change's monster key, name, HP, AC, initiative and footprint and keeps id, group, stats visibility and spawn position", () => {
    const changes = [
      toDireWolf(second.id, "Dire Wolf 1", {
        maxHp: 40,
        currentHp: 40,
        initiative: null,
      }),
      toDireWolf(first.id, "Dire Wolf 2"),
    ];

    const updated = repo.changeMonsters(changes, origin);

    const expectedSecond: MonsterInstance = {
      ...second,
      monsterKey: "dire-wolf",
      displayName: "Dire Wolf 1",
      maxHp: 40,
      currentHp: 40,
      armorClass: 14,
      initiative: null,
      footprint: 2,
    };
    const expectedFirst: MonsterInstance = {
      ...first,
      monsterKey: "dire-wolf",
      displayName: "Dire Wolf 2",
      maxHp: 37,
      currentHp: 31,
      armorClass: 14,
      initiative: 14,
      footprint: 2,
    };
    expect(updated).toEqual([expectedSecond, expectedFirst]);
    expect(byId(second.id)).toEqual(expectedSecond);
    expect(byId(first.id)).toEqual(expectedFirst);
    expect(byId(first.id)).toMatchObject({
      id: first.id,
      encounterId: first.encounterId,
      groupId: "g1",
      statsVisible: true,
      spawnPosition: { x: 250, y: 150 },
      createdAt: first.createdAt,
    });
    expect(byId(third.id)).toEqual(third);
  });

  it("changeMonsters appends one monster-changed event per change with the call's origin", () => {
    const seq = log.latestSeq();

    repo.changeMonsters(
      [
        toDireWolf(first.id, "Dire Wolf 1"),
        toDireWolf(second.id, "Dire Wolf 2", {
          currentHp: 37,
          initiative: null,
        }),
      ],
      origin,
    );

    expect(eventsAfter(seq)).toEqual([
      {
        type: "monster-changed",
        id: first.id,
        monsterKey: "dire-wolf",
        displayName: "Dire Wolf 1",
        maxHp: 37,
        currentHp: 31,
        armorClass: 14,
        initiative: 14,
        footprint: 2,
        origin,
      },
      {
        type: "monster-changed",
        id: second.id,
        monsterKey: "dire-wolf",
        displayName: "Dire Wolf 2",
        maxHp: 37,
        currentHp: 37,
        armorClass: 14,
        initiative: null,
        footprint: 2,
        origin,
      },
    ]);
  });

  it("changeMonsters throws UnknownInstanceError and changes nothing when any id is unknown or removed", () => {
    repo.removeInstances([third.id], setupOrigin);
    const before = repo.listInstances();
    const seq = log.latestSeq();

    expect(() =>
      repo.changeMonsters(
        [
          toDireWolf(first.id, "Dire Wolf 1"),
          toDireWolf("missing", "Dire Wolf 2"),
        ],
        origin,
      ),
    ).toThrow(UnknownInstanceError);
    expect(() =>
      repo.changeMonsters(
        [
          toDireWolf(first.id, "Dire Wolf 1"),
          toDireWolf(third.id, "Dire Wolf 2"),
        ],
        origin,
      ),
    ).toThrow(UnknownInstanceError);

    expect(repo.listInstances()).toEqual(before);
    expect(eventsAfter(seq)).toEqual([]);
  });

  it("changeMonsters throws InvalidNameError and changes nothing when a new name is used by another instance", () => {
    const before = repo.listInstances();
    const seq = log.latestSeq();

    // Another live instance's name.
    expect(() =>
      repo.changeMonsters(
        [
          toDireWolf(first.id, "Dire Wolf 1"),
          toDireWolf(second.id, "Goblin 1"),
        ],
        origin,
      ),
    ).toThrow(InvalidNameError);
    // A name given earlier in the same call.
    expect(() =>
      repo.changeMonsters(
        [
          toDireWolf(first.id, "Dire Wolf 1"),
          toDireWolf(second.id, "Dire Wolf 1"),
        ],
        origin,
      ),
    ).toThrow(InvalidNameError);

    expect(repo.listInstances()).toEqual(before);
    expect(eventsAfter(seq)).toEqual([]);
  });
});
