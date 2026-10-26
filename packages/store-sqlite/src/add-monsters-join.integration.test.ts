import { beforeEach, describe, expect, it } from "vitest";
import {
  AddMonstersError,
  addMonsters,
  type AddMonstersDeps,
  type AddMonstersGroup,
  type AddMonstersOptions,
  type ChangeOrigin,
  type NewMonsterInstance,
  type Rng,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

const WOLF = "srd-2024_wolf";
const GOBLIN = "srd-2024_goblin-warrior";
const monsters = loadSrdMonsters();
if (!monsters.byKey.has(WOLF) || !monsters.byKey.has(GOBLIN)) {
  throw new Error("SRD fixtures missing");
}

let repo: SqliteEncounterRepository;
let calls: number;
let groupN: number;

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max; counts every draw. */
function countingRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      calls++;
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

function deps(over: Partial<AddMonstersDeps> = {}): AddMonstersDeps {
  return {
    repo,
    monsters,
    rng: countingRng(7, 12, 3, 18, 9, 1),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newGroupId: () => `group-${++groupN}`,
    ...over,
  };
}

function add(groups: AddMonstersGroup[], options: AddMonstersOptions = {}) {
  return addMonsters(deps(), groups, origin, options);
}

function seed(...items: NewMonsterInstance[]): void {
  repo.addInstances(() => items, origin);
}

function stored(name: string) {
  const found = repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

function initiativeRolls(rolls: { label?: string }[]): string[] {
  return rolls
    .map((r) => r.label ?? "")
    .filter((label) => label.includes("initiative"));
}

/** Runs `fn`, expecting an AddMonstersError; returns its code. */
function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AddMonstersError);
    return (e as AddMonstersError).code;
  }
  throw new Error("expected an AddMonstersError, got none");
}

beforeEach(() => {
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(openDatabase(":memory:"), {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  calls = 0;
  groupN = 0;
});

describe("addMonsters with join", () => {
  it("a group with join takes the member's groupId and current initiative and rolls only its HP", () => {
    add([{ monster: WOLF, count: 2 }]);
    repo.setInitiative(stored("Wolf 1").id, 17, origin);
    repo.setInitiative(stored("Wolf 2").id, 17, origin);
    const groupsBefore = groupN;

    const rolled = add([{ monster: WOLF, count: 2, join: "Wolf 1" }]);
    expect(rolled.instances.map((i) => [i.groupId, i.initiative])).toEqual([
      ["group-1", 17],
      ["group-1", 17],
    ]);
    expect(rolled.instances.map((i) => i.hpMode)).toEqual(["rolled", "rolled"]);
    expect(rolled.rolls.map((r) => r.label)).toEqual([
      "Wolf 3 HP",
      "Wolf 4 HP",
    ]);
    expect(groupN).toBe(groupsBefore);
    expect(
      ["Wolf 3", "Wolf 4"].map((n) => [
        stored(n).groupId,
        stored(n).initiative,
      ]),
    ).toEqual([
      ["group-1", 17],
      ["group-1", 17],
    ]);

    calls = 0;
    const averaged = add([
      { monster: WOLF, count: 1, hp: "average", join: "Wolf 1" },
    ]);
    expect(calls).toBe(0);
    expect(averaged.rolls).toEqual([]);
    expect(averaged.instances.map((i) => [i.groupId, i.initiative])).toEqual([
      ["group-1", 17],
    ]);
  });

  it("join finds the member by instance id as well as by exact display name", () => {
    add([{ monster: WOLF, count: 1 }]);
    add([{ monster: GOBLIN, count: 1 }]);
    const wolf = stored("Wolf 1");
    const goblin = stored("Goblin Warrior 1");

    const byId = add([{ monster: WOLF, count: 1, join: wolf.id }]);
    expect(byId.instances.map((i) => [i.groupId, i.initiative])).toEqual([
      [wolf.groupId, wolf.initiative],
    ]);

    const byName = add([
      { monster: GOBLIN, count: 1, join: "Goblin Warrior 1" },
    ]);
    expect(byName.instances.map((i) => [i.groupId, i.initiative])).toEqual([
      [goblin.groupId, goblin.initiative],
    ]);
  });

  it("a group joining a member with no initiative gets no initiative", () => {
    seed({
      monsterKey: WOLF,
      displayName: "Wolf 1",
      maxHp: 11,
      initiative: null,
      groupId: "pack",
    });
    const { instances, rolls } = add([
      { monster: WOLF, count: 2, join: "Wolf 1" },
    ]);
    expect(instances.map((i) => [i.groupId, i.initiative])).toEqual([
      ["pack", null],
      ["pack", null],
    ]);
    expect(initiativeRolls(rolls)).toEqual([]);
    expect(
      ["Wolf 2", "Wolf 3"].map((n) => [
        stored(n).groupId,
        stored(n).initiative,
      ]),
    ).toEqual([
      ["pack", null],
      ["pack", null],
    ]);
  });

  it("in each mode a joined group rolls no initiative while a new group in the same call rolls as usual", () => {
    add([{ monster: WOLF, count: 1 }]);
    const member = stored("Wolf 1");
    const { instances, rolls } = add(
      [
        { monster: WOLF, count: 2, join: "Wolf 1" },
        { monster: GOBLIN, count: 2 },
      ],
      { initiative: "each" },
    );
    expect(initiativeRolls(rolls)).toEqual([
      "Goblin Warrior 1 initiative",
      "Goblin Warrior 2 initiative",
    ]);
    expect(instances.map((i) => [i.name, i.groupId])).toEqual([
      ["Wolf 2", member.groupId],
      ["Wolf 3", member.groupId],
      ["Goblin Warrior 1", "group-2"],
      ["Goblin Warrior 2", "group-2"],
    ]);
    expect(instances[0]?.initiative).toBe(member.initiative);
    expect(instances[1]?.initiative).toBe(member.initiative);
  });

  it("joined monsters' names continue one above the group's highest number in use, leaving a removed member's number unfilled", () => {
    add([{ monster: WOLF, count: 3 }]);
    repo.removeInstances([stored("Wolf 2").id], origin);
    const member = stored("Wolf 1");
    const { instances } = add([{ monster: WOLF, count: 2, join: "Wolf 1" }]);
    expect(instances.map((i) => [i.name, i.groupId])).toEqual([
      ["Wolf 4", member.groupId],
      ["Wolf 5", member.groupId],
    ]);
  });

  it("a group with join and no statsVisible takes the member's stats visibility; one that sets it keeps its own", () => {
    add([{ monster: WOLF, count: 1, statsVisible: true }]);
    add([{ monster: GOBLIN, count: 1 }]);

    add([
      { monster: WOLF, count: 1, join: "Wolf 1" },
      { monster: WOLF, count: 1, join: "Wolf 1", statsVisible: false },
      { monster: GOBLIN, count: 1, join: "Goblin Warrior 1" },
      {
        monster: GOBLIN,
        count: 1,
        join: "Goblin Warrior 1",
        statsVisible: true,
      },
      { monster: GOBLIN, count: 1 },
    ]);
    expect(
      repo.listInstances().map((i) => [i.displayName, i.statsVisible]),
    ).toEqual([
      ["Wolf 1", true],
      ["Goblin Warrior 1", false],
      ["Wolf 2", true],
      ["Wolf 3", false],
      ["Goblin Warrior 2", false],
      ["Goblin Warrior 3", true],
      ["Goblin Warrior 4", false],
    ]);
    expect(stored("Wolf 2").groupId).toBe(stored("Wolf 1").groupId);
  });

  it("a join that matches no instance throws AddMonstersError unknown_group, adds nothing and rolls nothing", () => {
    add([{ monster: WOLF, count: 2 }]);
    const before = repo.listInstances();
    calls = 0;
    const groupsBefore = groupN;
    expect(
      errorCode(() =>
        add([
          { monster: GOBLIN, count: 1 },
          { monster: WOLF, count: 1, join: "Wolf 9" },
        ]),
      ),
    ).toBe("unknown_group");
    expect(repo.listInstances()).toEqual(before);
    expect(calls).toBe(0);
    expect(groupN).toBe(groupsBefore);
  });

  it("a join that matches several monsters by name, or a member with no group, throws AddMonstersError unknown_group and adds nothing", () => {
    seed(
      {
        monsterKey: WOLF,
        displayName: "Twin",
        maxHp: 11,
        initiative: 5,
        groupId: "a",
      },
      {
        monsterKey: WOLF,
        displayName: "Twin",
        maxHp: 11,
        initiative: 9,
        groupId: "b",
      },
      {
        monsterKey: WOLF,
        displayName: "Loner",
        maxHp: 11,
        initiative: 12,
        groupId: null,
      },
    );
    const before = repo.listInstances();

    expect(
      errorCode(() => add([{ monster: WOLF, count: 1, join: "Twin" }])),
    ).toBe("unknown_group");
    expect(
      errorCode(() => add([{ monster: WOLF, count: 1, join: "Loner" }])),
    ).toBe("unknown_group");
    expect(calls).toBe(0);
    expect(repo.listInstances()).toEqual(before);
  });
});
