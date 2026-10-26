import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnknownInstanceError,
  UnknownMonsterError,
  resetMaxHp,
  type ChangeOrigin,
  type LoggedEvent,
  type MonsterInstance,
  type Rng,
  type ResetMaxHpDeps,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import { openDatabase } from "./db.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };
const origin: ChangeOrigin = { source: "mcp", commandId: "reset" };

const WOLF = "srd-2024_wolf";
const GOBLIN = "srd-2024_goblin-warrior";
const monsters = loadSrdMonsters();
const wolf = monsters.byKey.get(WOLF);
const goblin = monsters.byKey.get(GOBLIN);
if (!wolf || !goblin) throw new Error("SRD fixtures missing");

const NOW = "2026-01-01T00:00:00.000Z";

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max; counts calls. */
function cycleRng(...values: number[]): Rng & { calls: number } {
  let i = 0;
  const rng = {
    calls: 0,
    nextInt(max: number) {
      rng.calls++;
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
  return rng;
}

let db: DatabaseSync;
let repo: SqliteEncounterRepository;

function deps(rng: Rng): ResetMaxHpDeps {
  return { repo, monsters, rng, now: () => new Date(NOW) };
}

function idOf(name: string): string {
  const found = repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found.id;
}

const hpOf = (): [string, number, number][] =>
  repo
    .listInstances()
    .map(
      (i) => [i.displayName, i.currentHp, i.maxHp] as [string, number, number],
    );

const hpValues = (i: MonsterInstance) => ({
  currentHp: i.currentHp,
  maxHp: i.maxHp,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  repo.addInstances(
    () => [
      // Full HP, max below the Wolf's average.
      {
        monsterKey: WOLF,
        displayName: "Wolf 1",
        maxHp: 8,
        initiative: 14,
        armorClass: 13,
        groupId: "g1",
        statsVisible: true,
        spawnPosition: { x: 100, y: 200 },
      },
      // Full HP, max above the Wolf's average.
      {
        monsterKey: WOLF,
        displayName: "Wolf 2",
        maxHp: 15,
        initiative: 14,
        armorClass: 12,
        groupId: "g1",
        spawnPosition: { x: 150, y: 200 },
      },
      // Damaged to 12/14, max above the Goblin Warrior's average.
      {
        monsterKey: GOBLIN,
        displayName: "Goblin Warrior 1",
        maxHp: 14,
        initiative: 9,
        armorClass: 15,
        groupId: "g2",
      },
      // Damaged to 3/6, max below the Goblin Warrior's average.
      {
        monsterKey: GOBLIN,
        displayName: "Goblin Warrior 2",
        maxHp: 6,
        initiative: null,
        armorClass: null,
        groupId: null,
      },
    ],
    seedOrigin,
  );
  repo.applyDamage(idOf("Goblin Warrior 1"), 2, seedOrigin);
  repo.applyDamage(idOf("Goblin Warrior 2"), 3, seedOrigin);
});

describe("resetMaxHp", () => {
  it("resetMaxHp in average mode sets each instance's max HP to its monster's average and returns each instance before and after with no rolls", () => {
    const wolfId = idOf("Wolf 2");
    const goblinId = idOf("Goblin Warrior 2");
    const rng = cycleRng(4);

    const result = resetMaxHp(deps(rng), [wolfId, goblinId], "average", origin);

    expect(rng.calls).toBe(0);
    expect(result.rolls).toEqual([]);
    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]?.before).toMatchObject({
      id: wolfId,
      maxHp: 15,
    });
    expect(result.instances[0]?.after).toMatchObject({
      id: wolfId,
      maxHp: wolf.hp.average,
    });
    expect(result.instances[1]?.before).toMatchObject({
      id: goblinId,
      maxHp: 6,
    });
    expect(result.instances[1]?.after).toMatchObject({
      id: goblinId,
      maxHp: goblin.hp.average,
    });
    expect(hpOf().map(([name, , max]) => [name, max])).toEqual([
      ["Wolf 1", 8],
      ["Wolf 2", wolf.hp.average],
      ["Goblin Warrior 1", 14],
      ["Goblin Warrior 2", goblin.hp.average],
    ]);
  });

  it('resetMaxHp in rolled mode rolls each instance\'s HP dice in the order of the given ids and returns the rolls labelled "<name> HP"', () => {
    const goblinId = idOf("Goblin Warrior 2");
    const wolfId = idOf("Wolf 2");
    // Each die shows the rng value plus one. Goblin Warrior (3d6): 2 + 3 + 4;
    // then Wolf (2d8 + 2): 5 + 6 + 2.
    const rng = cycleRng(1, 2, 3, 4, 5);

    const result = resetMaxHp(deps(rng), [goblinId, wolfId], "rolled", origin);

    expect(rng.calls).toBe(5);
    expect(result.rolls).toHaveLength(2);
    expect(result.rolls[0]).toMatchObject({
      expression: goblin.hp.dice,
      dice: [[2, 3, 4]],
      total: 9,
      label: "Goblin Warrior 2 HP",
      timestamp: NOW,
    });
    expect(result.rolls[1]).toMatchObject({
      expression: wolf.hp.dice,
      dice: [[5, 6]],
      total: 13,
      label: "Wolf 2 HP",
      timestamp: NOW,
    });
    expect(result.instances.map((c) => [c.after.id, c.after.maxHp])).toEqual([
      [goblinId, 9],
      [wolfId, 13],
    ]);
    expect(hpOf().map(([name, , max]) => [name, max])).toEqual([
      ["Wolf 1", 8],
      ["Wolf 2", 13],
      ["Goblin Warrior 1", 14],
      ["Goblin Warrior 2", 9],
    ]);
  });

  it("resetMaxHp ends an instance that was at full HP at full HP at the new max, whether the max goes up or down, and returns its before values and the full after values", () => {
    const up = idOf("Wolf 1");
    const down = idOf("Wolf 2");

    const result = resetMaxHp(deps(cycleRng(0)), [up, down], "average", origin);

    const average = wolf.hp.average;
    expect(
      result.instances.map((c) => [hpValues(c.before), hpValues(c.after)]),
    ).toEqual([
      [
        { currentHp: 8, maxHp: 8 },
        { currentHp: average, maxHp: average },
      ],
      [
        { currentHp: 15, maxHp: 15 },
        { currentHp: average, maxHp: average },
      ],
    ]);
    expect(hpOf().slice(0, 2)).toEqual([
      ["Wolf 1", average, average],
      ["Wolf 2", average, average],
    ]);
  });

  it("resetMaxHp keeps a damaged instance's current HP, lowered to the new max when above it", () => {
    const lowered = idOf("Goblin Warrior 1");
    const kept = idOf("Goblin Warrior 2");

    const result = resetMaxHp(
      deps(cycleRng(0)),
      [lowered, kept],
      "average",
      origin,
    );

    const average = goblin.hp.average;
    expect(
      result.instances.map((c) => [hpValues(c.before), hpValues(c.after)]),
    ).toEqual([
      [
        { currentHp: 12, maxHp: 14 },
        { currentHp: average, maxHp: average },
      ],
      [
        { currentHp: 3, maxHp: 6 },
        { currentHp: 3, maxHp: average },
      ],
    ]);
    expect(hpOf().slice(2)).toEqual([
      ["Goblin Warrior 1", average, average],
      ["Goblin Warrior 2", 3, average],
    ]);
  });

  it("resetMaxHp changes only max HP and current HP: id, name, initiative, group, armor class, stats visibility and spawn position are unchanged", () => {
    const kept = (i: MonsterInstance) => ({
      id: i.id,
      displayName: i.displayName,
      initiative: i.initiative,
      groupId: i.groupId,
      armorClass: i.armorClass,
      statsVisible: i.statsVisible,
      spawnPosition: i.spawnPosition,
    });
    const before = repo.listInstances();
    const ids = before.map((i) => i.id);

    const result = resetMaxHp(
      deps(cycleRng(0, 1, 2, 3, 4, 5, 6)),
      ids,
      "rolled",
      origin,
    );

    expect(repo.listInstances().map(kept)).toEqual(before.map(kept));
    expect(result.instances.map((c) => kept(c.after))).toEqual(
      before.map(kept),
    );
    expect(repo.listInstances().map((i) => i.maxHp)).not.toEqual(
      before.map((i) => i.maxHp),
    );
  });

  it("resetMaxHp records only hp-changed events, each carrying the caller's origin", () => {
    const log = new SqliteEncounterLog(db);
    const since = log.latestSeq();
    const ids = repo.listInstances().map((i) => i.id);

    resetMaxHp(deps(cycleRng(0)), ids, "average", origin);

    const isEvent = (
      entry: LoggedEvent | UnreadableLogEntry,
    ): entry is LoggedEvent => "event" in entry;
    const events = log
      .eventsSince(since)
      .filter(isEvent)
      .map((logged) => logged.event);
    expect(events.length).toBeGreaterThanOrEqual(ids.length);
    for (const event of events) {
      expect(event).toMatchObject({ type: "hp-changed", origin });
    }
    expect(new Set(events.map((e) => ("id" in e ? e.id : null)))).toEqual(
      new Set(ids),
    );
  });

  it("resetMaxHp throws UnknownInstanceError for an id not in the encounter before any roll and changes no instance", () => {
    const before = repo.listInstances();
    const setMaxHp = vi.spyOn(repo, "setMaxHp");
    const setHp = vi.spyOn(repo, "setHp");
    const rng = cycleRng(3);

    expect(() =>
      resetMaxHp(deps(rng), [idOf("Wolf 1"), "no-such-id"], "rolled", origin),
    ).toThrow(UnknownInstanceError);
    expect(rng.calls).toBe(0);
    expect(setMaxHp).not.toHaveBeenCalled();
    expect(setHp).not.toHaveBeenCalled();
    expect(repo.listInstances()).toEqual(before);
  });

  it("resetMaxHp throws UnknownMonsterError for an instance whose monster is not in the index before any roll and changes no instance", () => {
    repo.addInstances(
      () => [
        {
          monsterKey: "homebrew_not-in-the-srd",
          displayName: "Mystery 1",
          maxHp: 10,
        },
      ],
      seedOrigin,
    );
    const before = repo.listInstances();
    const setMaxHp = vi.spyOn(repo, "setMaxHp");
    const setHp = vi.spyOn(repo, "setHp");
    const rng = cycleRng(3);

    expect(() =>
      resetMaxHp(
        deps(rng),
        [idOf("Wolf 1"), idOf("Mystery 1")],
        "rolled",
        origin,
      ),
    ).toThrow(UnknownMonsterError);
    expect(rng.calls).toBe(0);
    expect(setMaxHp).not.toHaveBeenCalled();
    expect(setHp).not.toHaveBeenCalled();
    expect(repo.listInstances()).toEqual(before);
  });
});
