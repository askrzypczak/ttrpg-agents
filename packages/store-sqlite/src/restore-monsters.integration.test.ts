import { beforeEach, describe, expect, it } from "vitest";
import {
  RestoreMonstersError,
  TargetError,
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

describe("restoreMonsters", () => {
  it("restoreMonsters by name brings a removed monster back with its id, HP, initiative, group and stats visibility", () => {
    const [, b] = seed(
      shadow("Shadow 1", { groupId: "g1", initiative: 14 }),
      shadow("Shadow 2", { groupId: "g1", initiative: 14, statsVisible: true }),
    );
    const before = repo.applyDamage(b!.id, 6, seedOrigin).after;
    repo.removeInstances([b!.id], removeOrigin);

    const restored = restoreMonsters(deps(), ["Shadow 2"], origin);

    expect(restored).toEqual([{ instance: before, renamedFrom: null }]);
    expect(repo.listInstances().find((i) => i.id === b!.id)).toEqual(before);
    expect(before).toMatchObject({
      currentHp: 10,
      initiative: 14,
      groupId: "g1",
      statsVisible: true,
    });
    expect(repo.listRemovedInstances()).toEqual([]);
  });

  it("restoreMonsters gives a monster whose name was taken meanwhile the next free number and reports its old name", () => {
    const [, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);
    seed(shadow("Shadow 2"), shadow("Shadow 3"));

    const restored = restoreMonsters(deps(), [b!.id], origin);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.instance.id).toBe(b!.id);
    expect(restored[0]?.instance.displayName).toBe("Shadow 4");
    expect(restored[0]?.renamedFrom).toBe("Shadow 2");
    expect(repo.listInstances().map((i) => i.displayName)).toEqual([
      "Shadow 1",
      "Shadow 4",
      "Shadow 2",
      "Shadow 3",
    ]);
  });

  it("restoreMonsters with a target still in the encounter throws RestoreMonstersError not_removed and changes nothing", () => {
    const [, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);
    const before = state();

    let thrown: unknown;
    try {
      restoreMonsters(deps(), ["Shadow 2", "Shadow 1"], origin);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RestoreMonstersError);
    expect((thrown as RestoreMonstersError).code).toBe("not_removed");
    expect(state()).toEqual(before);
  });

  it("restoreMonsters with an unknown target throws TargetError and changes nothing", () => {
    const [, b] = seed(shadow("Shadow 1"), shadow("Shadow 2"));
    repo.removeInstances([b!.id], removeOrigin);
    const before = state();

    let thrown: unknown;
    try {
      restoreMonsters(deps(), ["Shadow 2", "Ghost"], origin);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(TargetError);
    expect(state()).toEqual(before);
    expect(repo.listRemovedInstances()).toHaveLength(1);
  });

  it("restoreMonsters with a removed monster whose type is not in the index throws RestoreMonstersError unknown_monster and changes nothing", () => {
    const [b, c] = seed(shadow("Shadow 1"), {
      monsterKey: "homebrew_gloom",
      displayName: "Gloom",
      maxHp: 9,
    });
    repo.removeInstances([b!.id, c!.id], removeOrigin);
    const before = state();

    let thrown: unknown;
    try {
      restoreMonsters(deps(), ["Shadow 1", "Gloom"], origin);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RestoreMonstersError);
    expect((thrown as RestoreMonstersError).code).toBe("unknown_monster");
    expect(state()).toEqual(before);
    expect(repo.listRemovedInstances()).toHaveLength(2);
  });

  it("restoreMonsters numbers a renamed monster past the names kept earlier in the same call", () => {
    const removedItems = seed(
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    );
    repo.removeInstances(
      removedItems.map((i) => i.id),
      removeOrigin,
    );
    seed(shadow("Shadow 1"));

    const restored = restoreMonsters(
      deps(),
      ["Shadow 1", "Shadow 3", "Shadow 2"],
      origin,
    );

    expect(
      restored.map((r) => [r.instance.displayName, r.renamedFrom]),
    ).toEqual([
      ["Shadow 2", "Shadow 1"],
      ["Shadow 3", null],
      ["Shadow 4", "Shadow 2"],
    ]);
    expect(
      repo
        .listInstances()
        .map((i) => i.displayName)
        .sort(),
    ).toEqual(["Shadow 1", "Shadow 2", "Shadow 3", "Shadow 4"]);
  });
});
