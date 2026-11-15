import { describe, expect, it } from "vitest";
import type {
  EncounterDirectory,
  InstanceInEncounter,
  OpenScene,
} from "../encounter/directory.js";
import { UnknownMonsterError } from "../encounter/errors.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { EncounterRepository } from "../encounter/repository.js";
import type { Encounter } from "../encounter/types.js";
import {
  makeTestCreatureRepository,
  makeTestInstance,
  makeTestMonster,
  type TestCreatureRepository,
} from "../testing/index.js";
import { checkMonster } from "./check.js";
import { createCreature } from "./create-creature.js";
import { createMonsterIndex } from "./creatures.js";
import {
  BuiltInMonsterError,
  CreatureInUseError,
  CreatureNameTakenError,
  InvalidCreatureError,
} from "./errors.js";
import type { Monster, MonsterEntry } from "./schema.js";
import {
  editCreature,
  listCreatures,
  removeCreature,
  type CreatureCommandDeps,
  type EditCreatureRequest,
} from "./stored-creatures.js";
import type { MonsterSet } from "./types.js";

/** An invented built-in monster, standing in for an SRD statblock. */
const builtInMossling: Monster = makeTestMonster({
  key: "srd-2024_ancient-mossling",
  name: "Ancient Mossling",
  source: { book: "srd-5.2" },
});

function builtInSet(): MonsterSet {
  const monsters = [builtInMossling];
  return {
    monsters,
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(),
    dndBeyondPages: new Map(),
  };
}

const ambush: Encounter = { id: "enc-1", name: "Ambush", createdAt: 1 };
const bridge: Encounter = { id: "enc-2", name: "Bridge", createdAt: 2 };

/** A directory with a current encounter when `current` is set; records each noted command and serves the live instances configured per monster key. */
class CreatureDirectory implements Pick<
  EncounterDirectory,
  | "transaction"
  | "getOpenScene"
  | "getCurrentEncounter"
  | "repositoryFor"
  | "findLiveInstancesOfMonster"
> {
  current: Encounter | undefined;
  readonly live = new Map<string, InstanceInEncounter[]>();
  readonly notes: { encounterId: string; origin: ChangeOrigin }[] = [];

  constructor(current: Encounter | undefined) {
    this.current = current;
  }

  getOpenScene(): OpenScene | undefined {
    return undefined;
  }

  getCurrentEncounter(): Encounter | undefined {
    return this.current;
  }

  findLiveInstancesOfMonster(monsterKey: string): InstanceInEncounter[] {
    return (this.live.get(monsterKey) ?? []).map((found) => ({
      encounter: { ...found.encounter },
      instance: { ...found.instance },
    }));
  }

  repositoryFor(encounterId: string): EncounterRepository {
    return {
      noteCommand: (origin: ChangeOrigin) => {
        this.notes.push({ encounterId, origin });
      },
    } as unknown as EncounterRepository;
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }
}

const origin: ChangeOrigin = {
  source: "mcp",
  commandId: "command-1",
  command: "edit_creature",
};

function setup(
  stored: readonly Monster[] = [makeTestMonster()],
  current?: Encounter,
): {
  deps: CreatureCommandDeps;
  creatures: TestCreatureRepository;
  directory: CreatureDirectory;
} {
  const creatures = makeTestCreatureRepository(stored);
  const directory = new CreatureDirectory(current);
  return {
    deps: {
      monsters: createMonsterIndex(builtInSet(), creatures),
      creatures,
      directory,
    },
    creatures,
    directory,
  };
}

function edit(
  deps: CreatureCommandDeps,
  request: EditCreatureRequest,
): ReturnType<typeof editCreature> {
  return editCreature(deps, request, origin);
}

/** The error fn throws; fails the test when it returns. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const storedKeys = (creatures: TestCreatureRepository): string[] =>
  creatures.listRecords().map((r) => r.key);

/** Two live Mosslings, one in each encounter. */
function liveMosslings(): InstanceInEncounter[] {
  return [
    {
      encounter: ambush,
      instance: makeTestInstance({
        id: "i1",
        encounterId: ambush.id,
        monsterKey: "homebrew_mossling",
        displayName: "Mossling 1",
        maxHp: 5,
        currentHp: 5,
      }),
    },
    {
      encounter: bridge,
      instance: makeTestInstance({
        id: "i2",
        encounterId: bridge.id,
        monsterKey: "homebrew_mossling",
        displayName: "Mossling 2",
        maxHp: 5,
        currentHp: 3,
      }),
    },
  ];
}

const bogMossling = makeTestMonster({
  key: "homebrew_bog-mossling",
  name: "Bog Mossling",
});

describe("editCreature", () => {
  it("editCreature applies the changes to the stored statblock and replaces it under the same key and book, returning it with the statblock before", () => {
    const { deps, creatures } = setup();

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { ac: 14, senses: { darkvision: 60 } },
    });

    const expected: Monster = {
      ...makeTestMonster(),
      ac: 14,
      senses: { darkvision: 60 },
    };
    expect(edited.monster).toEqual(expected);
    expect(edited.before).toEqual(makeTestMonster());
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
    expect(creatures.getRecord("homebrew_mossling")?.data).toEqual(expected);
    expect(deps.monsters.get("homebrew_mossling")?.source.book).toBe(
      "homebrew",
    );
  });

  it("editCreature with a page sets that page and keeps the book, and without one keeps the stored page", () => {
    const paged = makeTestMonster({ source: { book: "homebrew", page: 4 } });

    const withPage = setup([paged]);
    const repaged = edit(withPage.deps, {
      key: "homebrew_mossling",
      page: 9,
      changes: {},
    });
    expect(repaged.monster.source).toEqual({ book: "homebrew", page: 9 });
    expect(
      (withPage.creatures.getRecord("homebrew_mossling")?.data as Monster)
        .source,
    ).toEqual({ book: "homebrew", page: 9 });

    const withoutPage = setup([paged]);
    const kept = edit(withoutPage.deps, {
      key: "homebrew_mossling",
      changes: { ac: 12 },
    });
    expect(kept.monster.source).toEqual({ book: "homebrew", page: 4 });
    expect(
      (withoutPage.creatures.getRecord("homebrew_mossling")?.data as Monster)
        .source,
    ).toEqual({ book: "homebrew", page: 4 });
  });

  it("editCreature stores the statblock with its key set to the row key, even when the stored data carries another key", () => {
    const { deps, creatures } = setup([]);
    creatures.put(
      "homebrew_mossling",
      makeTestMonster({ key: "homebrew_moss-elder" }),
    );

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { name: "Moss Elder" },
    });

    expect(edited.monster.key).toBe("homebrew_mossling");
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
    expect(
      (creatures.getRecord("homebrew_mossling")?.data as Monster).key,
    ).toBe("homebrew_mossling");
  });

  it("editCreature refuses a built-in key with BuiltInMonsterError naming create_creature and from, and stores nothing", () => {
    const { deps, creatures, directory } = setup([], ambush);
    const original = JSON.parse(JSON.stringify(builtInMossling)) as Monster;

    const error = thrown(() =>
      edit(deps, { key: "srd-2024_ancient-mossling", changes: { ac: 15 } }),
    );

    expect(error).toBeInstanceOf(BuiltInMonsterError);
    expect(messageOf(error)).toContain("create_creature");
    expect(messageOf(error)).toMatch(/\bfrom\b/);
    expect(storedKeys(creatures)).toEqual([]);
    expect(deps.monsters.get("srd-2024_ancient-mossling")).toEqual(original);
    expect(directory.notes).toEqual([]);
  });

  it("editCreature refuses a key with no stored creature with UnknownMonsterError naming list_creatures", () => {
    const { deps, creatures } = setup();

    const error = thrown(() =>
      edit(deps, { key: "homebrew_nope", changes: { ac: 15 } }),
    );

    expect(error).toBeInstanceOf(UnknownMonsterError);
    expect(messageOf(error)).toContain("list_creatures");
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
  });

  it("editCreature renames a creature and keeps its key", () => {
    const { deps, creatures } = setup();

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { name: "Bog Mossling" },
    });

    expect(edited.monster.key).toBe("homebrew_mossling");
    expect(edited.monster.name).toBe("Bog Mossling");
    expect(edited.before.name).toBe("Mossling");
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
    expect(deps.monsters.get("homebrew_mossling")?.name).toBe("Bog Mossling");
  });

  it.each(["Bog Mossling", "BOG MOSSLING", "bog mossling"])(
    "editCreature refuses a rename to a name another creature of its book has, in any letter case, naming that creature, and changes nothing (%s)",
    (name) => {
      const { deps, creatures } = setup([makeTestMonster(), bogMossling]);

      const error = thrown(() =>
        edit(deps, { key: "homebrew_mossling", changes: { name } }),
      );

      expect(error).toBeInstanceOf(CreatureNameTakenError);
      expect(messageOf(error)).toContain("homebrew_bog-mossling");
      expect(creatures.getRecord("homebrew_mossling")?.data).toEqual(
        makeTestMonster(),
      );
      expect(creatures.getRecord("homebrew_bog-mossling")?.data).toEqual(
        bogMossling,
      );
    },
  );

  it("editCreature accepts the creature's own name in another letter case", () => {
    const { deps, creatures } = setup();

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { name: "MOSSLING" },
    });

    expect(edited.monster.name).toBe("MOSSLING");
    expect(
      (creatures.getRecord("homebrew_mossling")?.data as Monster).name,
    ).toBe("MOSSLING");
  });

  it("after editCreature renames a creature, createCreature of its new name in the same book is refused", () => {
    const { deps, creatures } = setup();
    edit(deps, {
      key: "homebrew_mossling",
      changes: { name: "Moss Elder" },
    });

    const error = thrown(() =>
      createCreature(
        deps,
        {
          book: "homebrew",
          from: "homebrew_mossling",
          changes: { name: "Moss Elder" },
        },
        origin,
      ),
    );

    expect(error).toBeInstanceOf(CreatureNameTakenError);
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
  });

  it("editCreature whose changes leave the statblock invalid throws InvalidCreatureError naming the field and changes nothing", () => {
    const { deps, creatures, directory } = setup([makeTestMonster()], ambush);

    const error = thrown(() =>
      edit(deps, {
        key: "homebrew_mossling",
        changes: { hp: { dice: "2d6", average: 9 } },
      }),
    );

    expect(error).toBeInstanceOf(InvalidCreatureError);
    expect(messageOf(error)).toMatch(/^hp\.average\b/m);
    expect(creatures.getRecord("homebrew_mossling")?.data).toEqual(
      makeTestMonster(),
    );
    expect(directory.notes).toEqual([]);
  });

  it("editCreature returns the live instances of the key in every encounter and changes none of them", () => {
    const { deps, directory } = setup();
    const live = liveMosslings();
    directory.live.set("homebrew_mossling", live);
    directory.live.set("homebrew_bog-mossling", [
      {
        encounter: ambush,
        instance: makeTestInstance({
          id: "i3",
          encounterId: ambush.id,
          monsterKey: "homebrew_bog-mossling",
          displayName: "Bog Mossling 1",
        }),
      },
    ]);

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { ac: 16, hp: { dice: "4d8" } },
    });

    expect(edited.liveInstances).toEqual(liveMosslings());
    expect(directory.live.get("homebrew_mossling")).toEqual(liveMosslings());
  });

  it("editCreature returns checkMonster's report of the edited statblock", () => {
    const { deps } = setup();
    const slam: MonsterEntry = {
      name: "Slam",
      desc: "Melee Attack Roll: +2, reach 5 ft. 9 (1d4) Bludgeoning damage.",
    };

    const edited = edit(deps, {
      key: "homebrew_mossling",
      changes: { sections: { actions: { add: [slam] } } },
    });

    expect(edited.check).toEqual(checkMonster(edited.monster));
    expect(edited.check.findings).toContainEqual(
      expect.objectContaining({ code: "damage_average", found: 9 }),
    );
  });

  it("editCreature notes its command with the given origin on the current encounter", () => {
    const { deps, directory } = setup([makeTestMonster()], bridge);

    edit(deps, { key: "homebrew_mossling", changes: { ac: 11 } });

    expect(directory.notes).toEqual([{ encounterId: bridge.id, origin }]);
  });
});

describe("removeCreature", () => {
  it("removeCreature deletes the stored creature and returns it when no live instance uses its key", () => {
    const { deps, creatures, directory } = setup([
      makeTestMonster(),
      bogMossling,
    ]);
    directory.live.set("homebrew_bog-mossling", [
      {
        encounter: ambush,
        instance: makeTestInstance({
          monsterKey: "homebrew_bog-mossling",
          displayName: "Bog Mossling 1",
        }),
      },
    ]);

    const removed = removeCreature(deps, "homebrew_mossling", origin);

    expect(removed).toEqual({
      key: "homebrew_mossling",
      monster: makeTestMonster(),
    });
    expect(storedKeys(creatures)).toEqual(["homebrew_bog-mossling"]);
    expect(deps.monsters.get("homebrew_mossling")).toBeUndefined();
  });

  it("removeCreature refuses while live instances in any encounter use the key, with CreatureInUseError naming each instance and its encounter and suggesting remove_monsters and change_monster_type, and deletes nothing", () => {
    const { deps, creatures, directory } = setup([makeTestMonster()], ambush);
    directory.live.set("homebrew_mossling", liveMosslings());

    const error = thrown(() =>
      removeCreature(deps, "homebrew_mossling", origin),
    );

    expect(error).toBeInstanceOf(CreatureInUseError);
    const message = messageOf(error);
    expect(message).toContain("Mossling 1 (Ambush)");
    expect(message).toContain("Mossling 2 (Bridge)");
    expect(message).toContain("remove_monsters");
    expect(message).toContain("change_monster_type");
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
    expect(directory.notes).toEqual([]);
  });

  it.each(["srd-2024_ancient-mossling", "homebrew_nope"])(
    "removeCreature refuses a built-in or unknown key with UnknownMonsterError naming list_creatures, and deletes nothing (%s)",
    (key) => {
      const { deps, creatures } = setup();

      const error = thrown(() => removeCreature(deps, key, origin));

      expect(error).toBeInstanceOf(UnknownMonsterError);
      expect(messageOf(error)).toContain("list_creatures");
      expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
      expect(deps.monsters.get("srd-2024_ancient-mossling")).toEqual(
        builtInMossling,
      );
    },
  );

  it("removeCreature deletes a stored record that fails monsterSchema, by its key", () => {
    const { deps, creatures } = setup();
    creatures.put("homebrew_broken", { name: "Broken", ac: "high" });

    const removed = removeCreature(deps, "homebrew_broken", origin);

    expect(removed).toEqual({ key: "homebrew_broken", monster: undefined });
    expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
  });

  it("removeCreature notes its command with the given origin on the current encounter", () => {
    const { deps, directory } = setup([makeTestMonster()], ambush);

    removeCreature(deps, "homebrew_mossling", origin);

    expect(directory.notes).toEqual([{ encounterId: ambush.id, origin }]);
  });
});

describe("listCreatures", () => {
  const ashMossling = makeTestMonster({
    key: "my-campaign_ash-mossling",
    name: "Ash Mossling",
    source: { book: "my-campaign", page: 3 },
  });

  it("listCreatures lists the stored creatures sorted by key and no built-in monster", () => {
    const { deps } = setup([ashMossling, makeTestMonster(), bogMossling]);

    expect(listCreatures(deps.monsters)).toEqual([
      bogMossling,
      makeTestMonster(),
      ashMossling,
    ]);
  });

  it("listCreatures with a book lists only that book's creatures", () => {
    const { deps } = setup([ashMossling, makeTestMonster(), bogMossling]);

    expect(listCreatures(deps.monsters, "homebrew")).toEqual([
      bogMossling,
      makeTestMonster(),
    ]);
    expect(listCreatures(deps.monsters, "my-campaign")).toEqual([ashMossling]);
    expect(listCreatures(deps.monsters, "other-book")).toEqual([]);
  });
});
