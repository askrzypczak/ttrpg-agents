import { z } from "zod";

export const MONSTER_SOURCES = ["srd-5.2", "private"] as const;

// Unbounded: Open5e has bad values (e.g. Octopus CHA -3), kept as-is.
const abilityScore = z.number().int();
const modifier = z.number().int();
const feet = z.number().int().min(0);

/** A named block of rules text (trait, action, reaction, ...). */
export const monsterEntrySchema = z.object({
  name: z.string().min(1),
  desc: z.string(),
  /** Legendary actions only: how many of the legendary action points it costs. */
  cost: z.number().int().min(1).optional(),
  /** Usage limit, e.g. { type: "RECHARGE_ON_ROLL", param: 5 } or { type: "PER_DAY", param: 3 }. */
  usage: z.object({ type: z.string().min(1), param: z.number() }).optional(),
  /** Only usable in a given form or with an item, e.g. "Vampire Form Only". */
  limitedToForm: z.string().min(1).optional(),
});

export const monsterSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(MONSTER_SOURCES),
  size: z.string().min(1),
  type: z.string().min(1),
  alignment: z.string(),
  ac: z.number().int().min(0),
  armorDetail: z.string(),
  hp: z.object({
    average: z.number().int().min(0),
    dice: z.string(),
  }),
  speeds: z.object({
    walk: feet.optional(),
    fly: feet.optional(),
    swim: feet.optional(),
    climb: feet.optional(),
    burrow: feet.optional(),
    hover: z.boolean().optional(),
  }),
  abilities: z.object({
    str: abilityScore,
    dex: abilityScore,
    con: abilityScore,
    int: abilityScore,
    wis: abilityScore,
    cha: abilityScore,
  }),
  initiativeModifier: modifier,
  cr: z.number().min(0),
  saves: z.object({
    str: modifier,
    dex: modifier,
    con: modifier,
    int: modifier,
    wis: modifier,
    cha: modifier,
  }),
  /** Only skills the creature is proficient in, as skill key -> bonus. */
  skills: z.record(z.string(), modifier),
  senses: z.object({
    darkvision: feet.optional(),
    blindsight: feet.optional(),
    tremorsense: feet.optional(),
    truesight: feet.optional(),
    passivePerception: z.number().int().optional(),
  }),
  languages: z.string(),
  damageVulnerabilities: z.array(z.string()),
  damageResistances: z.array(z.string()),
  damageImmunities: z.array(z.string()),
  conditionImmunities: z.array(z.string()),
  sections: z.object({
    traits: z.array(monsterEntrySchema),
    actions: z.array(monsterEntrySchema),
    bonusActions: z.array(monsterEntrySchema),
    reactions: z.array(monsterEntrySchema),
    legendaryActions: z.array(monsterEntrySchema),
  }),
});

export type MonsterEntry = z.infer<typeof monsterEntrySchema>;
export type Monster = z.infer<typeof monsterSchema>;
export type MonsterSource = (typeof MONSTER_SOURCES)[number];
