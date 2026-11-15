import { z } from "zod";
import { monsterEntrySchema, monsterSchema, type Monster } from "./schema.js";
import type { MonsterIndex } from "./types.js";

const shape = monsterSchema.shape;
const speeds = shape.speeds.shape;
const senses = shape.senses.shape;

/** Changes to one section, applied in this order: remove (entry names), replace (whole entries, matched by name), add (appended). */
export const creatureSectionChangesSchema = z.strictObject({
  remove: z.array(z.string().min(1)).optional(),
  replace: z.array(monsterEntrySchema).optional(),
  add: z.array(monsterEntrySchema).optional(),
});

export type CreatureSectionChanges = z.infer<
  typeof creatureSectionChangesSchema
>;

/** A partial statblock: what create_creature (and edit_creature) change. Strict: an unknown key is refused. No key or source. */
export const creatureChangesSchema = z.strictObject({
  name: shape.name.optional(),
  size: shape.size.optional(),
  type: shape.type.optional(),
  alignment: shape.alignment.optional(),
  armorDetail: shape.armorDetail.optional(),
  languages: shape.languages.optional(),
  ac: shape.ac.optional(),
  cr: shape.cr.optional(),
  initiativeModifier: shape.initiativeModifier.optional(),
  /** Without `average`, the engine sets the average the dice give. */
  hp: z
    .strictObject({
      dice: shape.hp.shape.dice,
      average: shape.hp.shape.average.optional(),
    })
    .optional(),
  abilities: z.strictObject(shape.abilities.partial().shape).optional(),
  saves: z.strictObject(shape.saves.partial().shape).optional(),
  /** null removes a speed. */
  speeds: z
    .strictObject({
      walk: speeds.walk.unwrap().nullable().optional(),
      fly: speeds.fly.unwrap().nullable().optional(),
      swim: speeds.swim.unwrap().nullable().optional(),
      climb: speeds.climb.unwrap().nullable().optional(),
      burrow: speeds.burrow.unwrap().nullable().optional(),
      hover: speeds.hover.unwrap().nullable().optional(),
    })
    .optional(),
  /** null removes a sense. */
  senses: z
    .strictObject({
      darkvision: senses.darkvision.unwrap().nullable().optional(),
      blindsight: senses.blindsight.unwrap().nullable().optional(),
      tremorsense: senses.tremorsense.unwrap().nullable().optional(),
      truesight: senses.truesight.unwrap().nullable().optional(),
      passivePerception: senses.passivePerception
        .unwrap()
        .nullable()
        .optional(),
    })
    .optional(),
  /** Skill key -> bonus; null removes a skill. */
  skills: z.record(z.string(), shape.initiativeModifier.nullable()).optional(),
  damageVulnerabilities: shape.damageVulnerabilities.optional(),
  damageResistances: shape.damageResistances.optional(),
  damageImmunities: shape.damageImmunities.optional(),
  conditionImmunities: shape.conditionImmunities.optional(),
  sections: z
    .strictObject({
      traits: creatureSectionChangesSchema.optional(),
      actions: creatureSectionChangesSchema.optional(),
      bonusActions: creatureSectionChangesSchema.optional(),
      reactions: creatureSectionChangesSchema.optional(),
      legendaryActions: creatureSectionChangesSchema.optional(),
    })
    .optional(),
});

export type CreatureChanges = z.infer<typeof creatureChangesSchema>;

/** A statblock being built: any field may be missing or wrong until parseCreatureDraft checks it. Engine-internal. */
export type CreatureDraft = { [K in keyof Monster]?: unknown };

/** A new draft: base with changes applied; base is not changed. Throws CreatureEntryError. Engine-internal. */
export function applyCreatureChanges(
  base: CreatureDraft,
  changes: CreatureChanges,
): CreatureDraft {
  void base;
  void changes;
  throw new Error("not implemented");
}

/** The draft validated by monsterSchema without its key; throws InvalidCreatureError naming every failing field. Engine-internal. */
export function parseCreatureDraft(draft: CreatureDraft): Omit<Monster, "key"> {
  void draft;
  throw new Error("not implemented");
}

/** `<book>_<slug of name>`, or undefined when the name has no letter or digit. Engine-internal. */
export function creatureKey(book: string, name: string): string | undefined {
  void book;
  void name;
  throw new Error("not implemented");
}

/** Throws CreatureNameTakenError (naming edit_creature) when a creature of book has name, ignoring case. Engine-internal. */
export function assertCreatureNameFree(
  monsters: MonsterIndex,
  book: string,
  name: string,
): void {
  void monsters;
  void book;
  void name;
  throw new Error("not implemented");
}
