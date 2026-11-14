import type { Monster } from "./schema.js";

export type MonsterSection = keyof Monster["sections"]; // traits | actions | bonusActions | reactions | legendaryActions
export type AbilityKey = keyof Monster["abilities"]; // str | dex | con | int | wis | cha

/** `7 (2d6) Fire damage`, or flat `1 Piercing damage` (no dice). */
export interface DamagePart {
  /** The printed number: the dice average, or the flat damage. */
  average: number;
  /** The dice as printed, e.g. "2d6 + 3"; absent for flat damage. */
  dice?: string;
  /** The damage type as printed, e.g. "Slashing". */
  type: string;
}

export interface AttackReport {
  kind: "melee" | "ranged" | "melee or ranged";
  bonus: number;
  /** Feet, when printed. */
  reach?: number;
  /** Feet, when printed: `range 80/320 ft.` is { normal: 80, long: 320 }. */
  range?: { normal: number; long?: number };
  /** The hit's damage chain; empty when none follows the reach or range. */
  damage: DamagePart[];
}

export interface SaveReport {
  ability: AbilityKey;
  dc: number;
  /** The damage chain right after this save's `Failure:`, else empty. */
  failure: DamagePart[];
}

export interface SpellcastingReport {
  saveDc?: number;
  attackBonus?: number;
}

/** A dice expression in an entry's text. */
export interface DiceMention {
  /** As printed, e.g. "2d6 + 3". */
  dice: string;
  /** The printed average when written `N (dice)`. */
  average?: number;
}

export interface EntryRef {
  section: MonsterSection;
  /** 0-based index in its section. */
  position: number;
  name: string;
}

export interface EntryReport extends EntryRef {
  /** An attack, a save or dice in the text; always false for Multiattack. */
  rolls: boolean;
  attack?: AttackReport;
  /** In text order. */
  saves: SaveReport[];
  spellcasting?: SpellcastingReport;
  /** Every dice expression, in text order (the fallback a later roll tool uses). */
  dice: DiceMention[];
}

export type CheckFindingCode =
  | "damage_average"
  | "attack_bonus"
  | "save_dc"
  | "spell_save_dc"
  | "spell_attack_bonus"
  | "save_modifier"
  | "initiative";

export interface CheckFinding {
  code: CheckFindingCode;
  /** damage_average, attack_bonus, save_dc, spell_save_dc, spell_attack_bonus. */
  entry?: EntryRef;
  /** save_modifier, initiative. */
  field?: "initiativeModifier" | `saves.${AbilityKey}`;
  /** The printed number. */
  found: number;
  /** Every value the engine accepts, ascending, no repeats. */
  expected: number[];
  /** attack_bonus: the value each ability gives. */
  byAbility?: Record<AbilityKey, number>;
  /** damage_average: the pair's dice. */
  dice?: string;
}

export interface MonsterCheck {
  /** Every entry: traits, actions, bonusActions, reactions, legendaryActions, each in array order. */
  entries: EntryReport[];
  /** Entries in report order (within one: attack_bonus, save_dc, spell_save_dc, spell_attack_bonus, damage_average), then save_modifier (str to cha), then initiative. */
  findings: CheckFinding[];
}

/** Reads a statblock's entries and checks its numbers. Pure: no I/O, does not change `monster`, never throws on entry text. */
export function checkMonster(monster: Monster): MonsterCheck {
  void monster;
  throw new Error("not implemented");
}
