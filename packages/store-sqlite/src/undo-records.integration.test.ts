import type { DatabaseSync } from "node:sqlite";
import type {
  ChangeOrigin,
  MonsterInstance,
  NewMonsterInstance,
} from "@ttrpg-agents/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const table: ChangeOrigin = { source: "table", commandId: "table-1" };

function mcp(commandId: string, command = "edit"): ChangeOrigin {
  return { source: "mcp", commandId, command };
}

let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let tick: number;

beforeEach(() => {
  tick = 1000;
  db = openDatabase(":memory:");
  repo = new SqliteEncounterRepository(db, { now: () => tick++ });
});

function item(displayName: string): NewMonsterInstance {
  return {
    monsterKey: "wolf",
    displayName,
    maxHp: 11,
    initiative: 12,
    armorClass: 13,
    groupId: "g1",
    spawnPosition: { x: 75, y: 75 },
  };
}

/** Seeds instances with a table origin, so the seed is not undoable. */
function seed(...names: string[]): MonsterInstance[] {
  return repo.addInstances(() => names.map(item), table);
}

function current(id: string): MonsterInstance {
  const found = repo.listInstances().find((i) => i.id === id);
  if (!found) throw new Error(`no live instance ${id}`);
  return found;
}

describe("undo records", () => {
  it("each mutation under an mcp origin records the instance's state before the command's first write, once per command and instance", () => {
    const [a, b] = seed("Wolf 1", "Wolf 2");
    const wolfA = a!;
    const wolfB = b!;

    // Two writes to one instance in one command keep its first before-state.
    repo.applyDamage(wolfA.id, 3, mcp("c-multi"));
    repo.applyDamage(wolfA.id, 2, mcp("c-multi"));
    repo.setArmorClass(wolfB.id, 15, mcp("c-multi"));
    const multi = repo.latestUndoRecord();
    expect(multi?.commandId).toBe("c-multi");
    expect(multi?.instances).toEqual([
      { instanceId: wolfA.id, before: wolfA },
      { instanceId: wolfB.id, before: wolfB },
    ]);

    const mutations: [string, (origin: ChangeOrigin) => unknown][] = [
      ["applyDamage", (o) => repo.applyDamage(wolfA.id, 1, o)],
      ["applyHealing", (o) => repo.applyHealing(wolfA.id, 1, o)],
      ["setHp", (o) => repo.setHp(wolfA.id, 4, o)],
      ["setMaxHp", (o) => repo.setMaxHp(wolfA.id, 20, o)],
      ["setArmorClass", (o) => repo.setArmorClass(wolfA.id, 17, o)],
      ["setInitiative", (o) => repo.setInitiative(wolfA.id, 3, o)],
      ["setGroupId", (o) => repo.setGroupId(wolfA.id, "g2", o)],
      ["setStatsVisible", (o) => repo.setStatsVisible(wolfA.id, true, o)],
      ["renameInstance", (o) => repo.renameInstance(wolfA.id, "Alpha", o)],
      [
        "setSpawnPositions",
        (o) =>
          repo.setSpawnPositions(
            [{ id: wolfA.id, spawnPosition: { x: 225, y: 75 } }],
            o,
          ),
      ],
      [
        "changeMonsters",
        (o) =>
          repo.changeMonsters(
            [
              {
                id: wolfA.id,
                monsterKey: "dire-wolf",
                displayName: "Dire Wolf 1",
                maxHp: 22,
                currentHp: 22,
                armorClass: 14,
                initiative: 9,
                footprint: 2,
              },
            ],
            o,
          ),
      ],
    ];
    for (const [method, mutate] of mutations) {
      const before = current(wolfA.id);
      const commandId = `c-${method}`;
      mutate(mcp(commandId, method));
      const record = repo.latestUndoRecord();
      expect(record?.commandId, method).toBe(commandId);
      expect(record?.command, method).toBe(method);
      expect(record?.instances, method).toEqual([
        { instanceId: wolfA.id, before },
      ]);
    }
  });

  it("addInstances under an mcp origin records each added id with no earlier state", () => {
    seed("Wolf 1");

    const added = repo.addInstances(
      () => [item("Wolf 2"), item("Wolf 3")],
      mcp("c-add", "add_monsters"),
    );

    expect(repo.latestUndoRecord()).toMatchObject({
      commandId: "c-add",
      command: "add_monsters",
      instances: added.map((i) => ({ instanceId: i.id, before: null })),
    });
  });

  it("removeInstances and restoreInstances under an mcp origin record the instances' earlier state", () => {
    const [a, b] = seed("Wolf 1", "Wolf 2");
    const damaged = repo.applyDamage(a!.id, 4, table).after;

    repo.removeInstances([a!.id, b!.id], mcp("c-remove", "remove_monsters"));
    expect(repo.latestUndoRecord()).toMatchObject({
      commandId: "c-remove",
      command: "remove_monsters",
      instances: [
        { instanceId: a!.id, before: damaged },
        { instanceId: b!.id, before: b },
      ],
    });

    repo.restoreInstances(
      [b!.id],
      () => "Wolf 2",
      mcp("c-restore", "restore_monsters"),
    );
    expect(repo.latestUndoRecord()).toMatchObject({
      commandId: "c-restore",
      command: "restore_monsters",
      instances: [{ instanceId: b!.id, before: b }],
    });
  });

  it("a write with a table origin records nothing", () => {
    const [a, b] = seed("Wolf 1", "Wolf 2");
    expect(repo.latestUndoRecord()).toBeUndefined();

    repo.setHp(a!.id, 3, table);
    repo.renameInstance(a!.id, "Alpha", table);
    repo.removeInstances([b!.id], table);
    expect(repo.latestUndoRecord()).toBeUndefined();

    repo.setArmorClass(a!.id, 16, mcp("c1"));
    repo.setInitiative(a!.id, 1, table);
    expect(repo.latestUndoRecord()).toMatchObject({
      commandId: "c1",
      instances: [{ instanceId: a!.id }],
    });
    expect(repo.latestUndoRecord()?.instances).toHaveLength(1);
  });

  it("noteCommand records the command with its name and no instances as the newest undo record", () => {
    const [a] = seed("Wolf 1");
    repo.applyDamage(a!.id, 2, mcp("c1", "apply_damage"));

    repo.noteCommand(mcp("c2", "set_rooms"));
    repo.noteCommand(mcp("c2", "set_rooms"));

    expect(repo.latestUndoRecord()).toEqual({
      commandId: "c2",
      command: "set_rooms",
      instances: [],
      events: [],
    });
    repo.forgetCommands(["c2"]);
    expect(repo.latestUndoRecord()?.commandId).toBe("c1");
  });

  it("latestUndoRecord returns the newest command with its name, its instances in first-write order, and its own and table events after its first write, oldest first; the logged events carry no command name", () => {
    const [a, b] = seed("Wolf 1", "Wolf 2");
    const origin = mcp("c1", "set_hp");

    repo.setHp(b!.id, 5, origin);
    repo.setHp(b!.id, 8, table);
    repo.setHp(a!.id, 6, origin);

    expect(repo.latestUndoRecord()).toEqual({
      commandId: "c1",
      command: "set_hp",
      instances: [
        { instanceId: b!.id, before: b },
        { instanceId: a!.id, before: a },
      ],
      events: [
        {
          type: "hp-changed",
          id: b!.id,
          currentHp: 5,
          maxHp: 11,
          origin: { source: "mcp", commandId: "c1" },
        },
        {
          type: "hp-changed",
          id: b!.id,
          currentHp: 8,
          maxHp: 11,
          origin: table,
        },
        {
          type: "hp-changed",
          id: a!.id,
          currentHp: 6,
          maxHp: 11,
          origin: { source: "mcp", commandId: "c1" },
        },
      ],
    });
    const rows = db
      .prepare("SELECT event FROM encounter_events ORDER BY seq")
      .all() as { event: string }[];
    for (const row of rows) {
      const event = JSON.parse(row.event) as { origin: object };
      expect(Object.keys(event.origin).sort()).toEqual(["commandId", "source"]);
    }
  });

  it("latestUndoRecord leaves out table events logged before the command's first write and other commands' mcp events", () => {
    const [a] = seed("Wolf 1");
    repo.setHp(a!.id, 9, table);

    repo.applyDamage(a!.id, 2, mcp("c1", "apply_damage"));
    repo.applyDamage(a!.id, 3, mcp("c2", "apply_damage"));
    repo.applyHealing(a!.id, 1, table);
    repo.forgetCommands(["c2"]);

    expect(repo.latestUndoRecord()?.events).toEqual([
      {
        type: "hp-changed",
        id: a!.id,
        currentHp: 7,
        maxHp: 11,
        origin: { source: "mcp", commandId: "c1" },
      },
      {
        type: "hp-changed",
        id: a!.id,
        currentHp: 5,
        maxHp: 11,
        origin: table,
      },
    ]);
  });

  it("forgetCommands deletes the given commands' records, so latestUndoRecord returns the command before", () => {
    const [a] = seed("Wolf 1");
    repo.applyDamage(a!.id, 1, mcp("c1"));
    repo.applyDamage(a!.id, 1, mcp("c2"));
    repo.applyDamage(a!.id, 1, mcp("c3"));

    repo.forgetCommands(["c3", "unknown"]);
    expect(repo.latestUndoRecord()?.commandId).toBe("c2");

    repo.forgetCommands(["c2", "c1"]);
    expect(repo.latestUndoRecord()).toBeUndefined();
  });

  it("a clear that clears monsters deletes the encounter's undo records; a clear of an empty encounter changes none", () => {
    const [a] = seed("Wolf 1");
    repo.applyDamage(a!.id, 1, mcp("c1"));
    repo.noteCommand(mcp("c2", "set_rooms"));

    repo.clearEncounter(mcp("c3", "clear_encounter"));
    expect(repo.latestUndoRecord()).toBeUndefined();

    const [b] = repo.addInstances(
      () => [item("Wolf 2")],
      mcp("c4", "add_monsters"),
    );
    repo.removeInstances([b!.id], mcp("c5", "remove_monsters"));
    repo.clearEncounter(mcp("c6", "clear_encounter"));
    expect(repo.latestUndoRecord()).toMatchObject({
      commandId: "c5",
      command: "remove_monsters",
    });
    repo.forgetCommands(["c5"]);
    expect(repo.latestUndoRecord()?.commandId).toBe("c4");
  });

  it("transaction rolls back every repository write made in it when fn throws", () => {
    const [a] = seed("Wolf 1");
    const failure = new Error("boom");

    expect(() =>
      repo.transaction(() => {
        repo.setHp(a!.id, 2, mcp("c1"));
        repo.renameInstance(a!.id, "Alpha", mcp("c1"));
        throw failure;
      }),
    ).toThrow(failure);

    expect(repo.listInstances()).toEqual([a]);
    expect(repo.latestUndoRecord()).toBeUndefined();
  });
});
