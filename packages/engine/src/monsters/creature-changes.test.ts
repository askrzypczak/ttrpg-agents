import { describe, expect, it } from "vitest";
import { makeTestMonster } from "../testing/index.js";
import {
  applyCreatureChanges,
  creatureKey,
  parseCreatureDraft,
} from "./creature-changes.js";
import { CreatureEntryError, InvalidCreatureError } from "./errors.js";
import type { Monster, MonsterEntry } from "./schema.js";

const bite: MonsterEntry = {
  name: "Bite",
  desc: "Melee Attack Roll: +2, reach 5 ft. 2 (1d4) Piercing damage.",
};
const claw: MonsterEntry = {
  name: "Claw",
  desc: "Melee Attack Roll: +2, reach 5 ft. 1 Slashing damage.",
};
const sporePuff: MonsterEntry = {
  name: "Spore Puff",
  desc: "The mossling releases a cloud of harmless spores.",
};

/** A Mossling with three actions: Bite, Claw and Spore Puff. */
function armedMossling(): Monster {
  const base = makeTestMonster();
  return {
    ...base,
    sections: { ...base.sections, actions: [bite, claw, sporePuff] },
  };
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

/** The statblock without its key, as a draft is validated. */
function withoutKey(monster: Monster): Omit<Monster, "key"> {
  const copy: Partial<Monster> = { ...monster };
  delete copy.key;
  return copy as Omit<Monster, "key">;
}

describe("applyCreatureChanges", () => {
  it("applyCreatureChanges replaces each scalar it is given, trims the name and keeps the base's other fields", () => {
    const base = makeTestMonster();

    const draft = applyCreatureChanges(base, {
      name: "  Bog Mossling ",
      size: "small",
      type: "plant",
      alignment: "neutral",
      ac: 13,
      armorDetail: "natural armor",
      cr: 0.5,
      languages: "Sylvan",
      initiativeModifier: 2,
    });

    expect(draft).toEqual({
      ...makeTestMonster(),
      name: "Bog Mossling",
      size: "small",
      type: "plant",
      alignment: "neutral",
      ac: 13,
      armorDetail: "natural armor",
      cr: 0.5,
      languages: "Sylvan",
      initiativeModifier: 2,
    });
  });

  it('applyCreatureChanges without an hp average sets the average the dice give, so dice "20" give 20', () => {
    const base = makeTestMonster();

    expect(applyCreatureChanges(base, { hp: { dice: "20" } }).hp).toEqual({
      dice: "20",
      average: 20,
    });
    expect(applyCreatureChanges(base, { hp: { dice: "3d6 + 3" } }).hp).toEqual({
      dice: "3d6 + 3",
      average: 13,
    });
  });

  it("applyCreatureChanges merges abilities and saves by key", () => {
    const draft = applyCreatureChanges(makeTestMonster(), {
      abilities: { str: 14, cha: 6 },
      saves: { dex: 2 },
    });

    expect(draft.abilities).toEqual({
      str: 14,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 6,
    });
    expect(draft.saves).toEqual({
      str: 0,
      dex: 2,
      con: 0,
      int: 0,
      wis: 0,
      cha: 0,
    });
  });

  it("applyCreatureChanges merges speeds, senses and skills by key, and null removes a key", () => {
    const base = makeTestMonster({
      speeds: { walk: 30, climb: 20 },
      senses: { darkvision: 60, passivePerception: 10 },
      skills: { perception: 2, stealth: 4 },
    });

    const draft = applyCreatureChanges(base, {
      speeds: { climb: null, fly: 40, hover: true },
      senses: { darkvision: null, tremorsense: 30 },
      skills: { stealth: null, athletics: 3 },
    });

    expect(draft.speeds).toEqual({ walk: 30, fly: 40, hover: true });
    expect(draft.senses).toEqual({ passivePerception: 10, tremorsense: 30 });
    expect(draft.skills).toEqual({ perception: 2, athletics: 3 });

    // An absent base value counts as empty.
    expect(applyCreatureChanges({}, { speeds: { walk: 25 } }).speeds).toEqual({
      walk: 25,
    });
  });

  it("applyCreatureChanges replaces the four damage and condition lists", () => {
    const base = makeTestMonster({
      damageVulnerabilities: ["Fire"],
      damageResistances: ["Cold"],
      damageImmunities: ["Poison"],
      conditionImmunities: ["Poisoned"],
    });

    const draft = applyCreatureChanges(base, {
      damageVulnerabilities: [],
      damageResistances: ["Acid", "Lightning"],
      damageImmunities: ["Necrotic"],
      conditionImmunities: ["Charmed", "Frightened"],
    });

    expect(draft.damageVulnerabilities).toEqual([]);
    expect(draft.damageResistances).toEqual(["Acid", "Lightning"]);
    expect(draft.damageImmunities).toEqual(["Necrotic"]);
    expect(draft.conditionImmunities).toEqual(["Charmed", "Frightened"]);
  });

  it("applyCreatureChanges removes, then replaces, then adds section entries, matching names ignoring case", () => {
    const newBite: MonsterEntry = {
      name: "Bite",
      desc: "Melee Attack Roll: +2, reach 5 ft. 3 (1d6) Piercing damage.",
    };
    const newClaw: MonsterEntry = {
      name: "Claw",
      desc: "Melee Attack Roll: +2, reach 10 ft. 1 Slashing damage.",
    };
    const tendril: MonsterEntry = {
      name: "Tendril",
      desc: "The mossling reaches out with a tendril of moss.",
    };

    const draft = applyCreatureChanges(armedMossling(), {
      sections: {
        // Claw is removed before Claw is added, so the remove matches one entry.
        actions: { remove: ["CLAW"], replace: [newBite], add: [newClaw] },
        traits: { add: [tendril] },
      },
    });

    expect(draft.sections).toEqual({
      traits: [tendril],
      actions: [newBite, sporePuff, newClaw],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    });

    const renamed = applyCreatureChanges(armedMossling(), {
      sections: {
        actions: { replace: [{ name: "spore puff", desc: "Thicker spores." }] },
      },
    });
    expect(
      (renamed.sections as Monster["sections"]).actions.map((e) => e.desc),
    ).toEqual([bite.desc, claw.desc, "Thicker spores."]);
  });

  it("applyCreatureChanges refuses a remove or replace name that matches no entry of its section, listing the section's names", () => {
    for (const actions of [
      { remove: ["Tail"] },
      { replace: [{ name: "Tail", desc: "A tail." }] },
    ]) {
      const error = thrown(() =>
        applyCreatureChanges(armedMossling(), { sections: { actions } }),
      );

      expect(error).toBeInstanceOf(CreatureEntryError);
      expect(messageOf(error)).toContain("actions");
      for (const name of ["Bite", "Claw", "Spore Puff"])
        expect(messageOf(error)).toContain(name);
    }
  });

  it("applyCreatureChanges refuses a name that matches several entries of its section, listing the section's names", () => {
    const base = makeTestMonster({
      sections: {
        traits: [
          { name: "Spongy", desc: "The mossling floats." },
          { name: "spongy", desc: "The mossling soaks up water." },
          { name: "Mossy Hide", desc: "The mossling blends into moss." },
        ],
        actions: [],
        bonusActions: [],
        reactions: [],
        legendaryActions: [],
      },
    });

    for (const traits of [
      { remove: ["SPONGY"] },
      { replace: [{ name: "Spongy", desc: "Floats." }] },
    ]) {
      const error = thrown(() =>
        applyCreatureChanges(base, { sections: { traits } }),
      );

      expect(error).toBeInstanceOf(CreatureEntryError);
      expect(messageOf(error)).toContain("traits");
      expect(messageOf(error)).toContain("Mossy Hide");
      expect(messageOf(error)).toContain("Spongy");
    }
  });

  it("applyCreatureChanges returns a new draft and leaves its base unchanged", () => {
    const base = makeTestMonster({
      speeds: { walk: 30, climb: 20 },
      senses: { darkvision: 60 },
      skills: { stealth: 4 },
      damageResistances: ["Cold"],
      sections: {
        traits: [],
        actions: [bite, claw],
        bonusActions: [],
        reactions: [],
        legendaryActions: [],
      },
    });
    const before = JSON.parse(JSON.stringify(base)) as unknown;

    const draft = applyCreatureChanges(base, {
      name: "Bog Mossling",
      hp: { dice: "20" },
      abilities: { str: 14 },
      saves: { str: 2 },
      speeds: { climb: null, fly: 40 },
      senses: { darkvision: null },
      skills: { stealth: null, athletics: 4 },
      damageResistances: ["Acid"],
      sections: {
        actions: {
          remove: ["Claw"],
          replace: [{ name: "Bite", desc: "A harder bite." }],
          add: [sporePuff],
        },
      },
    });

    expect(draft).not.toBe(base);
    expect(base).toEqual(before);
  });
});

describe("parseCreatureDraft", () => {
  it('parseCreatureDraft names each failing field by path, with a section entry\'s name after its index ("sections.actions[1] (Bite).cost")', () => {
    const valid = withoutKey(
      makeTestMonster({
        sections: {
          traits: [],
          actions: [claw, { ...bite, cost: 0 }],
          bonusActions: [],
          reactions: [],
          legendaryActions: [],
        },
      }),
    );
    const draft = { ...valid, ac: -1, abilities: { str: 10 } };

    const error = thrown(() => parseCreatureDraft(draft));

    expect(error).toBeInstanceOf(InvalidCreatureError);
    const message = messageOf(error);
    expect(message).toMatch(/^sections\.actions\[1\] \(Bite\)\.cost: /m);
    expect(message).toMatch(/^ac: /m);
    expect(message).toMatch(/^abilities\.dex: /m);
    expect(message).not.toMatch(/^sections\.actions\[0\]/m);

    const good = withoutKey(makeTestMonster());
    expect(parseCreatureDraft(good)).toEqual(good);
  });
});

describe("creatureKey", () => {
  it("creatureKey mints <book>_<slug>: lower case, accents folded, apostrophes dropped, other runs of non-alphanumerics one hyphen, none at either end", () => {
    expect(creatureKey("homebrew", "Goblin Shaman")).toBe(
      "homebrew_goblin-shaman",
    );
    expect(creatureKey("homebrew", "Will-o'-Wisp")).toBe(
      "homebrew_will-o-wisp",
    );
    expect(creatureKey("my-campaign", "  Élan Vîtal!! ")).toBe(
      "my-campaign_elan-vital",
    );
    expect(creatureKey("homebrew", "Mossling’s Hound -- II")).toBe(
      "homebrew_mosslings-hound-ii",
    );
    expect(creatureKey("homebrew", "Goblin, Shaman")).toBe(
      "homebrew_goblin-shaman",
    );
  });

  it("creatureKey gives undefined for a name with no letter or digit", () => {
    for (const name of ["!!!", "  ", "— '’ —"])
      expect(creatureKey("homebrew", name)).toBeUndefined();
  });
});
