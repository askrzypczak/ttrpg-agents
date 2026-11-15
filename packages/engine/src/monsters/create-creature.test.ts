import { describe, expect, it } from "vitest";
import type { EncounterDirectory, OpenScene } from "../encounter/directory.js";
import { UnknownMonsterError } from "../encounter/errors.js";
import type { ChangeOrigin } from "../encounter/origin.js";
import type { EncounterRepository } from "../encounter/repository.js";
import type { Encounter } from "../encounter/types.js";
import {
  makeTestCreatureRepository,
  makeTestMonster,
  type TestCreatureRepository,
} from "../testing/index.js";
import { checkMonster } from "./check.js";
import {
  createCreature,
  type CreateCreatureDeps,
  type CreateCreatureRequest,
} from "./create-creature.js";
import type { CreatureChanges } from "./creature-changes.js";
import { createMonsterIndex } from "./creatures.js";
import {
  BookTagError,
  CreatureNameTakenError,
  InvalidCreatureError,
} from "./errors.js";
import type { Monster, MonsterEntry } from "./schema.js";
import type { MonsterSet } from "./types.js";

/** An invented built-in monster, standing in for an SRD statblock. */
const builtInWarrior: Monster = makeTestMonster({
  key: "srd-2024_goblin-warrior",
  name: "Goblin Warrior",
  source: { book: "srd-5.2" },
  size: "small",
  skills: { stealth: 6 },
  senses: { darkvision: 60, passivePerception: 9 },
  sections: {
    traits: [],
    actions: [{ name: "Scimitar", desc: "The warrior slashes." }],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
  },
});

function builtInSet(): MonsterSet {
  const monsters = [builtInWarrior];
  return {
    monsters,
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(),
    dndBeyondPages: new Map(),
  };
}

/** A directory with one encounter, current when `current` is set; records each noted command. */
class NoteDirectory implements Pick<
  EncounterDirectory,
  "transaction" | "getOpenScene" | "getCurrentEncounter" | "repositoryFor"
> {
  readonly encounter: Encounter = { id: "enc-1", name: "Bridge", createdAt: 1 };
  current: boolean;
  readonly notes: { encounterId: string; origin: ChangeOrigin }[] = [];

  constructor(current: boolean) {
    this.current = current;
  }

  getOpenScene(): OpenScene | undefined {
    return undefined;
  }

  getCurrentEncounter(): Encounter | undefined {
    return this.current ? this.encounter : undefined;
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
  command: "create_creature",
};

function setup(
  stored: readonly Monster[] = [],
  current = false,
): {
  deps: CreateCreatureDeps;
  creatures: TestCreatureRepository;
  directory: NoteDirectory;
} {
  const creatures = makeTestCreatureRepository(stored);
  const directory = new NoteDirectory(current);
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

/** Every field a create from scratch needs: an invented Bog Mossling with no check findings. */
const required: CreatureChanges = {
  name: "Bog Mossling",
  size: "small",
  type: "plant",
  alignment: "neutral",
  ac: 12,
  hp: { dice: "2d6" },
  speeds: { walk: 20 },
  abilities: { str: 8, dex: 12, con: 10, int: 3, wis: 10, cha: 5 },
  saves: { str: -1, dex: 1, con: 0, int: -4, wis: 0, cha: -3 },
  initiativeModifier: 1,
  cr: 0.25,
  languages: "",
};

const emptySections: Monster["sections"] = {
  traits: [],
  actions: [],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

function create(
  deps: CreateCreatureDeps,
  request: CreateCreatureRequest,
): ReturnType<typeof createCreature> {
  return createCreature(deps, request, origin);
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

describe("createCreature", () => {
  it("createCreature from scratch stores the statblock under <book>_<slug> with source { book, page } and returns it", () => {
    const { deps, creatures } = setup();
    const spongy: MonsterEntry = {
      name: "Spongy",
      desc: "The mossling soaks up water.",
    };

    const created = create(deps, {
      book: "homebrew",
      page: 12,
      changes: { ...required, sections: { traits: { add: [spongy] } } },
    });

    const expected: Monster = {
      key: "homebrew_bog-mossling",
      name: "Bog Mossling",
      source: { book: "homebrew", page: 12 },
      size: "small",
      type: "plant",
      alignment: "neutral",
      ac: 12,
      armorDetail: "",
      hp: { average: 7, dice: "2d6" },
      speeds: { walk: 20 },
      abilities: { str: 8, dex: 12, con: 10, int: 3, wis: 10, cha: 5 },
      initiativeModifier: 1,
      cr: 0.25,
      saves: { str: -1, dex: 1, con: 0, int: -4, wis: 0, cha: -3 },
      skills: {},
      senses: {},
      languages: "",
      damageVulnerabilities: [],
      damageResistances: [],
      damageImmunities: [],
      conditionImmunities: [],
      sections: { ...emptySections, traits: [spongy] },
    };
    expect(created.monster).toEqual(expected);
    expect(created.from).toBeUndefined();
    expect(creatures.getRecord("homebrew_bog-mossling")?.data).toEqual(
      expected,
    );
    expect(deps.monsters.get("homebrew_bog-mossling")).toEqual(expected);
  });

  it("createCreature from scratch without abilities throws InvalidCreatureError naming abilities and stores nothing", () => {
    const { deps, creatures } = setup();
    const changes: CreatureChanges = { ...required };
    delete changes.abilities;

    const error = thrown(() => create(deps, { book: "homebrew", changes }));

    expect(error).toBeInstanceOf(InvalidCreatureError);
    expect(messageOf(error)).toMatch(/^abilities\b/m);
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature from scratch needs no sections, damage or condition lists, skills, senses or armor detail", () => {
    const { deps } = setup();

    const { monster } = create(deps, { book: "homebrew", changes: required });

    expect(monster.sections).toEqual(emptySections);
    expect(monster.damageVulnerabilities).toEqual([]);
    expect(monster.damageResistances).toEqual([]);
    expect(monster.damageImmunities).toEqual([]);
    expect(monster.conditionImmunities).toEqual([]);
    expect(monster.skills).toEqual({});
    expect(monster.senses).toEqual({});
    expect(monster.armorDetail).toBe("");
  });

  it("createCreature from scratch with no fields lists every missing required field by path and stores nothing", () => {
    const { deps, creatures } = setup();

    const error = thrown(() => create(deps, { book: "homebrew", changes: {} }));

    expect(error).toBeInstanceOf(InvalidCreatureError);
    const message = messageOf(error);
    for (const field of [
      "name",
      "size",
      "type",
      "alignment",
      "ac",
      "hp",
      "speeds",
      "abilities",
      "saves",
      "initiativeModifier",
      "cr",
      "languages",
    ])
      expect(message, field).toMatch(new RegExp(`^${field}\\b`, "m"));
    for (const field of [
      "armorDetail",
      "skills",
      "senses",
      "sections",
      "damageVulnerabilities",
      "damageResistances",
      "damageImmunities",
      "conditionImmunities",
    ])
      expect(message, field).not.toMatch(new RegExp(`^${field}\\b`, "m"));
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature with an hp average the dice do not give throws the schema's hp message and stores nothing", () => {
    const { deps, creatures } = setup();

    const error = thrown(() =>
      create(deps, {
        book: "homebrew",
        changes: { ...required, hp: { dice: "2d6", average: 9 } },
      }),
    );

    expect(error).toBeInstanceOf(InvalidCreatureError);
    expect(messageOf(error)).toContain(
      'hp.average: average 9 does not match dice "2d6" (average 7)',
    );
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature with a name that has no letter or digit throws InvalidCreatureError naming name and stores nothing", () => {
    const { deps, creatures } = setup();

    const error = thrown(() =>
      create(deps, { book: "homebrew", changes: { ...required, name: "!?" } }),
    );

    expect(error).toBeInstanceOf(InvalidCreatureError);
    expect(messageOf(error)).toMatch(/\bname\b/);
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature with from applies the changes to a copy of that statblock and keeps its name when none is given", () => {
    const { deps, creatures } = setup();
    const original = JSON.parse(JSON.stringify(builtInWarrior)) as Monster;

    const created = create(deps, {
      book: "homebrew",
      from: "srd-2024_goblin-warrior",
      changes: {
        hp: { dice: "20" },
        senses: { darkvision: null },
        sections: { actions: { remove: ["Scimitar"] } },
      },
    });

    expect(created.monster).toEqual({
      ...original,
      key: "homebrew_goblin-warrior",
      source: { book: "homebrew" },
      hp: { average: 20, dice: "20" },
      senses: { passivePerception: 9 },
      sections: emptySections,
    });
    expect(created.from).toEqual(original);
    expect(storedKeys(creatures)).toEqual(["homebrew_goblin-warrior"]);
    expect(builtInWarrior).toEqual(original);
    expect(deps.monsters.get("srd-2024_goblin-warrior")).toEqual(original);
  });

  it("createCreature stores the statblock with its key set to the row key, not the copied monster's key", () => {
    const { deps, creatures } = setup();

    const created = create(deps, {
      book: "homebrew",
      from: "srd-2024_goblin-warrior",
      changes: { name: "Goblin Shaman" },
    });

    expect(created.monster.key).toBe("homebrew_goblin-shaman");
    const record = creatures.getRecord("homebrew_goblin-shaman");
    expect(record?.key).toBe("homebrew_goblin-shaman");
    expect((record?.data as Monster | undefined)?.key).toBe(
      "homebrew_goblin-shaman",
    );
  });

  it("createCreature with an unknown from throws UnknownMonsterError and stores nothing", () => {
    const { deps, creatures } = setup();

    expect(() =>
      create(deps, {
        book: "homebrew",
        from: "homebrew_nope",
        changes: { name: "Nope" },
      }),
    ).toThrow(UnknownMonsterError);
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature refuses a name a creature of the same book has, in any letter case, naming edit_creature, and stores nothing", () => {
    for (const name of ["Mossling", "MOSSLING", "mossling"]) {
      const { deps, creatures } = setup([makeTestMonster()]);

      const error = thrown(() =>
        create(deps, { book: "homebrew", changes: { ...required, name } }),
      );

      expect(error, name).toBeInstanceOf(CreatureNameTakenError);
      expect(messageOf(error)).toContain("edit_creature");
      expect(messageOf(error)).toContain("homebrew_mossling");
      expect(storedKeys(creatures)).toEqual(["homebrew_mossling"]);
    }
  });

  it("createCreature accepts a name that a creature of another book has", () => {
    const { deps, creatures } = setup([makeTestMonster()]);

    const created = create(deps, {
      book: "my-campaign",
      changes: { ...required, name: "Mossling" },
    });

    expect(created.monster.key).toBe("my-campaign_mossling");
    expect(storedKeys(creatures)).toEqual([
      "homebrew_mossling",
      "my-campaign_mossling",
    ]);
  });

  it("createCreature refuses a key that a stored creature of another name holds, naming that creature, and stores nothing", () => {
    // Renamed after it was created, so its key no longer follows its name.
    const hexer = makeTestMonster({
      key: "homebrew_goblin-shaman",
      name: "Goblin Hexer",
    });
    const { deps, creatures } = setup([hexer]);

    const error = thrown(() =>
      create(deps, {
        book: "homebrew",
        changes: { ...required, name: "Goblin Shaman" },
      }),
    );

    expect(error).toBeInstanceOf(CreatureNameTakenError);
    expect(messageOf(error)).toContain("Goblin Hexer");
    expect(storedKeys(creatures)).toEqual(["homebrew_goblin-shaman"]);
    expect(creatures.getRecord("homebrew_goblin-shaman")?.data).toEqual(hexer);
  });

  it("createCreature refuses the book tag srd-2024 as reserved and stores nothing", () => {
    const { deps, creatures } = setup();

    expect(() =>
      create(deps, {
        book: "srd-2024",
        from: "srd-2024_goblin-warrior",
        changes: { name: "Goblin Shaman" },
      }),
    ).toThrow(BookTagError);
    expect(storedKeys(creatures)).toEqual([]);
  });

  it('createCreature refuses a book tag outside the schema\'s pattern ("Monster Manual") and stores nothing', () => {
    const { deps, creatures } = setup();

    expect(() =>
      create(deps, { book: "Monster Manual", changes: required }),
    ).toThrow(BookTagError);
    expect(storedKeys(creatures)).toEqual([]);
  });

  it("createCreature stores a statblock with findings and returns checkMonster's report with them", () => {
    const { deps, creatures } = setup();
    const slam: MonsterEntry = {
      name: "Slam",
      desc: "Melee Attack Roll: +1, reach 5 ft. 9 (1d4) Bludgeoning damage.",
    };

    const created = create(deps, {
      book: "homebrew",
      changes: { ...required, sections: { actions: { add: [slam] } } },
    });

    expect(creatures.getRecord("homebrew_bog-mossling")?.data).toEqual(
      created.monster,
    );
    expect(created.check).toEqual(checkMonster(created.monster));
    expect(created.check.findings).toContainEqual(
      expect.objectContaining({
        code: "damage_average",
        found: 9,
        expected: [2],
      }),
    );
  });

  it("createCreature notes its command with the given origin on the current encounter", () => {
    const { deps, directory } = setup([], true);

    create(deps, { book: "homebrew", changes: required });

    expect(directory.notes).toEqual([{ encounterId: "enc-1", origin }]);
  });
});
