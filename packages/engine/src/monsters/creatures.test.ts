import { describe, expect, it } from "vitest";
import { UnknownMonsterError } from "../encounter/errors.js";
import { rollInitiativeValues } from "../encounter/initiative.js";
import {
  AddMonstersError,
  validateAddMonsters,
} from "../encounter/validate-add-monsters.js";
import {
  createMonsterIndex,
  withQuarantineReason,
  type CreatureRecord,
  type CreatureRepository,
} from "./creatures.js";
import type { Monster } from "./schema.js";
import type { MonsterIndex, MonsterSet } from "./types.js";

/** An in-memory repository; `put` stores any data, as a store holding a bad record would. */
class MemoryCreatureRepository implements CreatureRepository {
  private readonly records = new Map<string, unknown>();

  put(key: string, data: unknown): void {
    this.records.set(key, structuredClone(data));
  }

  getRecord(key: string): CreatureRecord | undefined {
    if (!this.records.has(key)) return undefined;
    return { key, data: structuredClone(this.records.get(key)) };
  }

  listRecords(): CreatureRecord[] {
    return [...this.records.keys()]
      .sort()
      .map((key) => ({ key, data: structuredClone(this.records.get(key)) }));
  }

  insert(key: string, monster: Monster): void {
    if (this.records.has(key)) throw new Error(`duplicate key ${key}`);
    this.put(key, monster);
  }

  replace(key: string, monster: Monster): void {
    if (!this.records.has(key)) throw new Error(`no record ${key}`);
    this.put(key, monster);
  }

  delete(key: string): void {
    this.records.delete(key);
  }
}

function creature(key: string, name: string, book: string): Monster {
  return {
    key,
    name,
    source: { book },
    size: "small",
    type: "fey",
    alignment: "neutral",
    ac: 11,
    armorDetail: "",
    hp: { average: 4, dice: "1d8" },
    speeds: { walk: 25 },
    abilities: { str: 8, dex: 12, con: 10, int: 9, wis: 11, cha: 13 },
    initiativeModifier: 1,
    cr: 0,
    saves: { str: -1, dex: 1, con: 0, int: -1, wis: 0, cha: 1 },
    skills: {},
    senses: {},
    languages: "",
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
  };
}

const shadow = creature("srd-2024_shadow", "Shadow", "srd-5.2");
const ghoul = creature("srd-2024_ghoul", "Ghoul", "srd-5.2");
const thornling = creature("homebrew_thornling", "Thornling", "homebrew");
const mossback = creature("homebrew_mossback", "Mossback", "homebrew");

function builtInSet(
  aliases: Record<string, string> = {},
  dndBeyondPages: Record<string, string> = {},
): MonsterSet {
  const monsters = [shadow, ghoul];
  return {
    monsters,
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(Object.entries(aliases)),
    dndBeyondPages: new Map(Object.entries(dndBeyondPages)),
  };
}

function quarantineMessage(index: MonsterIndex, key: string): string {
  const entry = index.quarantined().find((q) => q.key === key);
  if (entry === undefined) throw new Error(`${key} is not quarantined`);
  return entry.message;
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("createMonsterIndex", () => {
  it("createMonsterIndex gets a valid stored creature by key and lists it after every built-in monster", () => {
    const repo = new MemoryCreatureRepository();
    repo.insert(thornling.key, thornling);
    repo.insert(mossback.key, mossback);
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.get("homebrew_thornling")).toEqual(thornling);
    expect(index.get("srd-2024_shadow")).toEqual(shadow);
    expect(index.list()).toEqual([shadow, ghoul, mossback, thornling]);
    expect(index.quarantined()).toEqual([]);
  });

  it("createMonsterIndex reads the repository on each call, so a record inserted after the index was built is returned by get and list", () => {
    const repo = new MemoryCreatureRepository();
    const index = createMonsterIndex(builtInSet(), repo);
    expect(index.get("homebrew_thornling")).toBeUndefined();
    expect(index.list()).toEqual([shadow, ghoul]);

    repo.insert(thornling.key, thornling);

    expect(index.get("homebrew_thornling")).toEqual(thornling);
    expect(index.list()).toEqual([shadow, ghoul, thornling]);
  });

  it("a stored record that fails monsterSchema is quarantined with a message naming its key and each failing field", () => {
    const repo = new MemoryCreatureRepository();
    repo.put("homebrew_thornling", {
      ...thornling,
      ac: "eleven",
      hp: { average: -1, dice: "1d8" },
    });
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.quarantined().map((q) => q.key)).toEqual([
      "homebrew_thornling",
    ]);
    const message = quarantineMessage(index, "homebrew_thornling");
    expect(message).toContain("homebrew_thornling");
    expect(message).toMatch(/(^|[^a-z.])ac:/);
    expect(message).toContain("hp.average");
  });

  it("a stored record whose statblock key differs from its record key is quarantined with a message naming both keys", () => {
    const repo = new MemoryCreatureRepository();
    repo.put(
      "homebrew_thornling",
      creature("homebrew_bramble", "Thornling", "homebrew"),
    );
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.get("homebrew_thornling")).toBeUndefined();
    const message = quarantineMessage(index, "homebrew_thornling");
    expect(message).toContain("homebrew_thornling");
    expect(message).toContain("homebrew_bramble");
  });

  it("a stored record whose key is not its book tag, one underscore and a slug of lower-case letters, digits and hyphens is quarantined", () => {
    const badKeys = [
      "thornling",
      "otherbook_thornling",
      "homebrew_Thornling",
      "homebrew_",
      "homebrew_thorn_ling",
    ];
    const repo = new MemoryCreatureRepository();
    for (const key of badKeys) {
      repo.put(key, creature(key, "Thornling", "homebrew"));
    }
    repo.insert("homebrew_thorn-ling-2", {
      ...thornling,
      key: "homebrew_thorn-ling-2",
    });
    const index = createMonsterIndex(builtInSet(), repo);

    expect(
      index
        .quarantined()
        .map((q) => q.key)
        .sort(),
    ).toEqual([...badKeys].sort());
    for (const key of badKeys) {
      const message = quarantineMessage(index, key);
      expect(message, key).toContain(`"${key}"`);
      expect(message, key).toContain('"homebrew_"');
      expect(index.get(key), key).toBeUndefined();
    }
    expect(index.get("homebrew_thorn-ling-2")?.key).toBe(
      "homebrew_thorn-ling-2",
    );
  });

  it("a stored record whose book tag begins with srd is quarantined", () => {
    const repo = new MemoryCreatureRepository();
    repo.put(
      "srd-5.2_thornling",
      creature("srd-5.2_thornling", "Thornling", "srd-5.2"),
    );
    repo.put("srdish_thornling", creature("srdish_thornling", "X", "srdish"));
    const index = createMonsterIndex(builtInSet(), repo);

    expect(
      index
        .quarantined()
        .map((q) => q.key)
        .sort(),
    ).toEqual(["srd-5.2_thornling", "srdish_thornling"]);
    expect(index.get("srd-5.2_thornling")).toBeUndefined();
    const message = quarantineMessage(index, "srd-5.2_thornling");
    expect(message).toContain('"srd-5.2_thornling"');
    expect(message).toContain('"srd-5.2"');
    expect(quarantineMessage(index, "srdish_thornling")).toContain('"srdish"');
  });

  it("quarantined records are absent from get and list while the valid stored records and every built-in monster still load", () => {
    const repo = new MemoryCreatureRepository();
    repo.insert(mossback.key, mossback);
    repo.put("homebrew_thornling", { ...thornling, name: "" });
    repo.put(
      "homebrew_puddlewisp",
      creature("homebrew_other", "Puddlewisp", "homebrew"),
    );
    const index = createMonsterIndex(builtInSet(), repo);

    expect(index.get("homebrew_thornling")).toBeUndefined();
    expect(index.get("homebrew_puddlewisp")).toBeUndefined();
    expect(index.get("homebrew_mossback")).toEqual(mossback);
    expect(index.get("srd-2024_ghoul")).toEqual(ghoul);
    expect(index.list()).toEqual([shadow, ghoul, mossback]);
    expect(
      index
        .quarantined()
        .map((q) => q.key)
        .sort(),
    ).toEqual(["homebrew_puddlewisp", "homebrew_thornling"]);
  });

  it("createMonsterIndex serves the built-in set's aliases and D&D Beyond pages, and no page for a stored creature", () => {
    const repo = new MemoryCreatureRepository();
    repo.insert(thornling.key, thornling);
    const index = createMonsterIndex(
      builtInSet(
        { Wight: "srd-2024_ghoul" },
        { "srd-2024_shadow": "9000001-shadow" },
      ),
      repo,
    );

    expect([...index.aliases()]).toEqual([["Wight", "srd-2024_ghoul"]]);
    expect(index.dndBeyondPage("srd-2024_shadow")).toBe("9000001-shadow");
    expect(index.dndBeyondPage("srd-2024_ghoul")).toBeUndefined();
    expect(index.dndBeyondPage("homebrew_thornling")).toBeUndefined();
  });
});

describe("withQuarantineReason", () => {
  it("withQuarantineReason appends the quarantine message for a quarantined key and returns the message unchanged for any other key", () => {
    const repo = new MemoryCreatureRepository();
    repo.insert(mossback.key, mossback);
    repo.put(
      "homebrew_thornling",
      creature("homebrew_bramble", "Thornling", "homebrew"),
    );
    const index = createMonsterIndex(builtInSet(), repo);
    const reason = quarantineMessage(index, "homebrew_thornling");

    expect(
      withQuarantineReason(
        index,
        "homebrew_thornling",
        'unknown monster "homebrew_thornling"',
      ),
    ).toBe(`unknown monster "homebrew_thornling". ${reason}`);
    for (const key of [
      "homebrew_nobody",
      "homebrew_mossback",
      "srd-2024_shadow",
    ]) {
      expect(withQuarantineReason(index, key, `unknown monster "${key}"`)).toBe(
        `unknown monster "${key}"`,
      );
    }
  });
});

describe("unknown-monster errors for a quarantined stored creature", () => {
  function indexWithQuarantinedThornling(): MonsterIndex {
    const repo = new MemoryCreatureRepository();
    repo.put(
      "homebrew_thornling",
      creature("homebrew_bramble", "Thornling", "homebrew"),
    );
    return createMonsterIndex(builtInSet(), repo);
  }

  it("validateAddMonsters with a quarantined stored key throws AddMonstersError unknown_monster whose message names the quarantine reason", () => {
    const index = indexWithQuarantinedThornling();
    const reason = quarantineMessage(index, "homebrew_thornling");

    const error = caught(() =>
      validateAddMonsters(
        index,
        [{ monster: "homebrew_thornling", count: 1 }],
        10,
        "group",
      ),
    );

    expect(error).toBeInstanceOf(AddMonstersError);
    expect((error as AddMonstersError).code).toBe("unknown_monster");
    expect((error as AddMonstersError).message).toContain(reason);
  });

  it("rollInitiativeValues for an instance whose stored creature is quarantined throws UnknownMonsterError whose message names the quarantine reason", () => {
    const index = indexWithQuarantinedThornling();
    const reason = quarantineMessage(index, "homebrew_thornling");

    const error = caught(() =>
      rollInitiativeValues(
        { monsters: index, rng: { nextInt: () => 0 }, now: () => new Date(0) },
        [{ monsterKey: "homebrew_thornling", displayName: "Thornling 1" }],
        "each",
      ),
    );

    expect(error).toBeInstanceOf(UnknownMonsterError);
    expect((error as UnknownMonsterError).code).toBe("unknown_monster");
    expect((error as UnknownMonsterError).message).toContain(reason);
  });
});
