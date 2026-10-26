import { beforeEach, describe, expect, it } from "vitest";
import {
  RestoreMonstersError,
  restoreEncounter,
  restoreMonsters,
  type ChangeOrigin,
  type MonsterInstance,
  type NewMonsterInstance,
  type RestoreMonstersDeps,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const seedOrigin: ChangeOrigin = { source: "mcp", commandId: "seed" };
const removeOrigin: ChangeOrigin = { source: "table", commandId: "remove" };
const clearOrigin: ChangeOrigin = { source: "mcp", commandId: "clear" };
const origin: ChangeOrigin = { source: "mcp", commandId: "restore" };

const SHADOW = "srd-2024_shadow";
const monsters = loadSrdMonsters();

let repo: SqliteEncounterRepository;

beforeEach(() => {
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(openDatabase(":memory:"), {
    newId: () => `id-${String(++n)}`,
    now: () => ++t,
  });
});

function deps(): RestoreMonstersDeps {
  return { repo, monsters };
}

function shadow(
  displayName: string,
  over: Partial<NewMonsterInstance> = {},
): NewMonsterInstance {
  return { monsterKey: SHADOW, displayName, maxHp: 16, ...over };
}

function seed(...items: NewMonsterInstance[]): MonsterInstance[] {
  return repo.addInstances(() => items, seedOrigin);
}

/** The encounter as seen from outside: live instances and removed ones. */
function state(): unknown {
  return {
    live: repo.listInstances(),
    removed: repo.listRemovedInstances(),
  };
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("restoreEncounter", () => {
  it("restoreEncounter brings back every cleared monster with its id, HP, initiative, group and stats visibility, in creation order", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1", { groupId: "g1", initiative: 14 }),
      shadow("Shadow 2", { groupId: "g1", initiative: 14, statsVisible: true }),
      shadow("Shadow 3", { initiative: 9 }),
    );
    const damaged = repo.applyDamage(b!.id, 6, seedOrigin).after;
    repo.clearEncounter(clearOrigin);

    const restored = restoreEncounter(deps(), origin);

    expect(restored).toEqual([
      { instance: a, renamedFrom: null },
      { instance: damaged, renamedFrom: null },
      { instance: c, renamedFrom: null },
    ]);
    expect(repo.listInstances()).toEqual([a, damaged, c]);
    expect(damaged).toMatchObject({
      currentHp: 10,
      initiative: 14,
      groupId: "g1",
      statsVisible: true,
    });
    expect(repo.listRemovedInstances()).toEqual([]);
  });

  it("restoreEncounter keeps the monsters added after the clear and gives a cleared monster whose name was taken the next free number", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.clearEncounter(clearOrigin);
    const [added] = seed(shadow("Shadow 2"));

    const restored = restoreEncounter(deps(), origin);

    expect(
      restored.map((r) => [
        r.instance.id,
        r.instance.displayName,
        r.renamedFrom,
      ]),
    ).toEqual([
      [a!.id, "Shadow 1", null],
      [b!.id, "Shadow 3", "Shadow 2"],
    ]);
    expect(repo.listInstances().map((i) => [i.id, i.displayName])).toEqual([
      [a!.id, "Shadow 1"],
      [b!.id, "Shadow 3"],
      [added!.id, "Shadow 2"],
    ]);
  });

  it("restoreEncounter leaves out a monster removed after the clear", () => {
    const [a, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.clearEncounter(clearOrigin);
    const [later] = seed(shadow("Shadow 3"));
    repo.removeInstances([later!.id], removeOrigin);

    const restored = restoreEncounter(deps(), origin);

    expect(restored.map((r) => r.instance.id)).toEqual([a!.id, b!.id]);
    expect(repo.listInstances().map((i) => i.id)).toEqual([a!.id, b!.id]);
    expect(repo.listRemovedInstances()).toEqual([
      { instance: later, removedBy: removeOrigin, cleared: false },
    ]);
  });

  it("restoreEncounter brings back the rest of the cleared monsters after one was restored with restoreMonsters", () => {
    const [a, b, c] = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.clearEncounter(clearOrigin);
    expect(repo.listRemovedInstances()).toHaveLength(3);
    restoreMonsters(deps(), ["Shadow 2"], origin);

    const restored = restoreEncounter(deps(), origin);

    expect(restored.map((r) => r.instance.id)).toEqual([a!.id, c!.id]);
    expect(repo.listInstances().map((i) => i.id)).toEqual([
      a!.id,
      b!.id,
      c!.id,
    ]);
    expect(repo.listRemovedInstances()).toEqual([]);
  });

  it("restoreEncounter with no cleared monster left throws RestoreMonstersError nothing_cleared and changes nothing", () => {
    const [, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);
    const neverCleared = state();

    const first = thrownBy(() => restoreEncounter(deps(), origin));

    expect(first).toBeInstanceOf(RestoreMonstersError);
    expect((first as RestoreMonstersError).code).toBe("nothing_cleared");
    expect(state()).toEqual(neverCleared);

    repo.clearEncounter(clearOrigin);
    restoreEncounter(deps(), origin);
    const allRestored = state();

    const second = thrownBy(() => restoreEncounter(deps(), origin));

    expect(second).toBeInstanceOf(RestoreMonstersError);
    expect((second as RestoreMonstersError).code).toBe("nothing_cleared");
    expect(state()).toEqual(allRestored);
  });

  it("restoreEncounter with a cleared monster whose type is not in the index throws RestoreMonstersError unknown_monster and changes nothing", () => {
    seed(shadow("Shadow 1"), {
      monsterKey: "homebrew_gloom",
      displayName: "Gloom",
      maxHp: 9,
    });
    repo.clearEncounter(clearOrigin);
    const before = state();

    const thrown = thrownBy(() => restoreEncounter(deps(), origin));

    expect(thrown).toBeInstanceOf(RestoreMonstersError);
    expect((thrown as RestoreMonstersError).code).toBe("unknown_monster");
    expect(state()).toEqual(before);
    expect(repo.listRemovedInstances()).toHaveLength(2);
  });
});
