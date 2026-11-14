import {
  DiceParseError,
  average,
  parseDice,
  type DiceExpression,
} from "../dice/index.js";
import { proficiencyBonus } from "./proficiency.js";
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
  const proficiency = proficiencyBonus(monster.cr);
  const mods = abilityModifiers(monster);
  const entries: EntryReport[] = [];
  const findings: CheckFinding[] = [];

  for (const section of SECTIONS) {
    monster.sections[section].forEach((entry, position) => {
      const ref: EntryRef = { section, position, name: entry.name };
      const read = readEntry(ref, entry.desc);
      entries.push(read.report);
      findings.push(...entryFindings(ref, read, proficiency, mods));
    });
  }

  for (const ability of ABILITIES) {
    const found = monster.saves[ability];
    const expected = ascendingUnique([
      mods[ability],
      mods[ability] + proficiency,
    ]);
    if (!expected.includes(found)) {
      findings.push({
        code: "save_modifier",
        field: `saves.${ability}`,
        found,
        expected,
      });
    }
  }

  const initiative = monster.initiativeModifier;
  const initiatives = ascendingUnique(
    [0, 1, 2].map((k) => mods.dex + k * proficiency),
  );
  if (!initiatives.includes(initiative)) {
    findings.push({
      code: "initiative",
      field: "initiativeModifier",
      found: initiative,
      expected: initiatives,
    });
  }

  return { entries, findings };
}

const SECTIONS: readonly MonsterSection[] = [
  "traits",
  "actions",
  "bonusActions",
  "reactions",
  "legendaryActions",
];

const ABILITIES: readonly AbilityKey[] = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

const ABILITY_BY_NAME: Readonly<Record<string, AbilityKey>> = {
  Strength: "str",
  Dexterity: "dex",
  Constitution: "con",
  Intelligence: "int",
  Wisdom: "wis",
  Charisma: "cha",
};

const ATTACK_KIND: Readonly<Record<string, AttackReport["kind"]>> = {
  Melee: "melee",
  Ranged: "ranged",
  "Melee or Ranged": "melee or ranged",
};

// A dice expression such as `2d6 + 3` or `d20`; a constant is left out when it is the count of another die
// (`2d6 + 1d4`), but not when only a word starting with "d" follows it (`1d4 + 1 days`).
const DICE = String.raw`\d*d\d+(?:\s*[+-]\s*\d+(?!\s*d\d))?`;
const UNIT = String.raw`(?:ft\.?|feet\.?)`;
// `7 (2d6) Fire damage` or flat `1 Piercing damage`.
const DAMAGE_PART = String.raw`(\d+)(?:\s+\((${DICE})\))?\s+([A-Za-z]+)\s+damage`;

const ATTACK_LEAD = new RegExp(
  String.raw`^\s*(Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+-]\d+)` +
    String.raw`(?:\s+to hit)?(?:\s*\([^)]*\))?,?\s*` +
    String.raw`(?:reach (\d+) ${UNIT})?(?:\s*or\s*)?` +
    String.raw`(?:range (\d+)(?:\/(\d+))? ${UNIT})?\s*(?:Hit:\s*)?`,
);
const SAVE =
  /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC (\d+)/g;
const FAILURE = /Failure:\s*/;
const SPELL_SAVE_DC = /spell save DC (\d+)/;
const SPELL_ATTACK_BONUS = /([+-]\d+) to hit with spell attacks/;
const DICE_MENTION = new RegExp(
  String.raw`(?:(?<![A-Za-z0-9])(\d+)\s+\()?(?<![A-Za-z0-9])(${DICE})(?![A-Za-z0-9])(\))?`,
  "g",
);

interface DicePair {
  dice: string;
  printed: number;
  expected: number;
}

interface EntryRead {
  report: EntryReport;
  /** Every `N (dice)` pair, in text order. */
  pairs: DicePair[];
}

function readEntry(ref: EntryRef, desc: string): EntryRead {
  const text = desc.replaceAll("**", "");
  const attack = readAttack(text);
  const saves = readSaves(text);
  const spellcasting = readSpellcasting(text);
  const { dice, pairs } = readDice(text);
  const multiattack = ref.name.trim().toLowerCase() === "multiattack";
  const rolls =
    !multiattack &&
    (attack !== undefined || saves.length > 0 || dice.length > 0);

  const report: EntryReport = { ...ref, rolls, saves, dice };
  if (attack) report.attack = attack;
  if (spellcasting) report.spellcasting = spellcasting;
  return { report, pairs };
}

function readAttack(text: string): AttackReport | undefined {
  const m = ATTACK_LEAD.exec(text);
  if (!m) return undefined;
  const [lead, kindText, bonusText, reach, normal, long] = m;
  const kind = kindText === undefined ? undefined : ATTACK_KIND[kindText];
  if (kind === undefined || bonusText === undefined) return undefined;
  const attack: AttackReport = {
    kind,
    bonus: toInt(bonusText),
    damage: readDamageChain(text, lead.length),
  };
  if (reach !== undefined) attack.reach = toInt(reach);
  if (normal !== undefined) {
    attack.range =
      long === undefined
        ? { normal: toInt(normal) }
        : { normal: toInt(normal), long: toInt(long) };
  }
  return attack;
}

function readSaves(text: string): SaveReport[] {
  const matches = [...text.matchAll(SAVE)];
  const saves: SaveReport[] = [];
  matches.forEach((m, i) => {
    const [whole, abilityName, dc] = m;
    const ability =
      abilityName === undefined ? undefined : ABILITY_BY_NAME[abilityName];
    if (ability === undefined || dc === undefined) return;
    const next = matches[i + 1];
    const span = text.slice(
      m.index + whole.length,
      next === undefined ? text.length : next.index,
    );
    const failure = FAILURE.exec(span);
    saves.push({
      ability,
      dc: toInt(dc),
      failure: failure
        ? readDamageChain(span, failure.index + failure[0].length)
        : [],
    });
  });
  return saves;
}

function readSpellcasting(text: string): SpellcastingReport | undefined {
  const saveDc = SPELL_SAVE_DC.exec(text)?.[1];
  const attackBonus = SPELL_ATTACK_BONUS.exec(text)?.[1];
  if (saveDc === undefined && attackBonus === undefined) return undefined;
  const report: SpellcastingReport = {};
  if (saveDc !== undefined) report.saveDc = toInt(saveDc);
  if (attackBonus !== undefined) report.attackBonus = toInt(attackBonus);
  return report;
}

function readDice(text: string): { dice: DiceMention[]; pairs: DicePair[] } {
  const dice: DiceMention[] = [];
  const pairs: DicePair[] = [];
  for (const m of text.matchAll(DICE_MENTION)) {
    const [, printed, expression, closing] = m;
    if (expression === undefined) continue;
    const parsed = tryParseDice(expression);
    if (!parsed) continue;
    if (printed !== undefined && closing !== undefined) {
      const printedAverage = toInt(printed);
      dice.push({ dice: expression, average: printedAverage });
      pairs.push({
        dice: expression,
        printed: printedAverage,
        expected: average(parsed),
      });
    } else {
      dice.push({ dice: expression });
    }
  }
  return { dice, pairs };
}

/** The damage chain starting at `at`: one part, then every part joined by ` plus `. */
function readDamageChain(text: string, at: number): DamagePart[] {
  const parts: DamagePart[] = [];
  const first = new RegExp(DAMAGE_PART, "y");
  const next = new RegExp(String.raw`\s+plus\s+${DAMAGE_PART}`, "y");
  let read = readDamagePart(first, text, at);
  while (read) {
    parts.push(read.part);
    read = readDamagePart(next, text, read.end);
  }
  return parts;
}

function readDamagePart(
  pattern: RegExp,
  text: string,
  at: number,
): { part: DamagePart; end: number } | undefined {
  pattern.lastIndex = at;
  const m = pattern.exec(text);
  if (!m) return undefined;
  const [, printed, dice, type] = m;
  if (printed === undefined || type === undefined) return undefined;
  const end = pattern.lastIndex;
  if (dice === undefined) {
    return { part: { average: toInt(printed), type }, end };
  }
  if (!tryParseDice(dice)) return undefined;
  return { part: { average: toInt(printed), dice, type }, end };
}

function entryFindings(
  ref: EntryRef,
  read: EntryRead,
  proficiency: number,
  mods: Record<AbilityKey, number>,
): CheckFinding[] {
  const { attack, saves, spellcasting } = read.report;
  const findings: CheckFinding[] = [];
  const entry = (): EntryRef => ({ ...ref });
  const bonuses = byAbility(mods, (mod) => proficiency + mod);
  const bonusValues = ascendingUnique(Object.values(bonuses));
  const dcs = ascendingUnique(
    Object.values(byAbility(mods, (mod) => 8 + proficiency + mod)),
  );

  if (attack && !bonusValues.includes(attack.bonus)) {
    findings.push({
      code: "attack_bonus",
      entry: entry(),
      found: attack.bonus,
      expected: [...bonusValues],
      byAbility: bonuses,
    });
  }
  for (const save of saves) {
    if (!dcs.includes(save.dc)) {
      findings.push({
        code: "save_dc",
        entry: entry(),
        found: save.dc,
        expected: [...dcs],
      });
    }
  }
  const spellDc = spellcasting?.saveDc;
  if (spellDc !== undefined && !dcs.includes(spellDc)) {
    findings.push({
      code: "spell_save_dc",
      entry: entry(),
      found: spellDc,
      expected: [...dcs],
    });
  }
  const spellBonus = spellcasting?.attackBonus;
  if (spellBonus !== undefined && !bonusValues.includes(spellBonus)) {
    findings.push({
      code: "spell_attack_bonus",
      entry: entry(),
      found: spellBonus,
      expected: [...bonusValues],
    });
  }
  for (const pair of read.pairs) {
    if (pair.printed !== pair.expected) {
      findings.push({
        code: "damage_average",
        entry: entry(),
        found: pair.printed,
        expected: [pair.expected],
        dice: pair.dice,
      });
    }
  }
  return findings;
}

function abilityModifiers(monster: Monster): Record<AbilityKey, number> {
  return byAbility(monster.abilities, (score) => Math.floor((score - 10) / 2));
}

function byAbility(
  values: Record<AbilityKey, number>,
  f: (value: number) => number,
): Record<AbilityKey, number> {
  return {
    str: f(values.str),
    dex: f(values.dex),
    con: f(values.con),
    int: f(values.int),
    wis: f(values.wis),
    cha: f(values.cha),
  };
}

function ascendingUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** A printed integer such as "+5", "-0" or "17"; "-0" reads as 0. */
function toInt(text: string): number {
  const n = Number(text);
  return n === 0 ? 0 : n;
}

function tryParseDice(text: string): DiceExpression | undefined {
  try {
    return parseDice(text);
  } catch (e) {
    // parseDice only throws DiceParseError; the rethrow is defensive.
    if (!(e instanceof DiceParseError)) throw e;
    return undefined;
  }
}
