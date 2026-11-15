import { z } from "zod";
import { DiceParseError, average, parseDice } from "../dice/index.js";
import {
  CreatureEntryError,
  CreatureNameTakenError,
  InvalidCreatureError,
} from "./errors.js";
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
  skills: z.record(z.string(), shape.skills.valueType.nullable()).optional(),
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

/** A deep copy of statblock data, which is plain JSON. */
function copyData<T>(data: T): T {
  return data === undefined ? data : (JSON.parse(JSON.stringify(data)) as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The base's record field merged with the changes; an absent base value counts as {}; null removes a key. */
function mergeByKey(
  base: unknown,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

const SECTION_KEYS = [
  "traits",
  "actions",
  "bonusActions",
  "reactions",
  "legendaryActions",
] as const;

/** An entry's name when it has one. */
function entryName(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.name === "string"
    ? entry.name
    : undefined;
}

/** The index of the one entry named `name` ignoring case; CreatureEntryError listing the section's names otherwise. */
function findEntry(
  entries: readonly unknown[],
  section: string,
  name: string,
): number {
  const wanted = name.toLowerCase();
  const matches: number[] = [];
  entries.forEach((entry, index) => {
    if (entryName(entry)?.toLowerCase() === wanted) matches.push(index);
  });
  if (matches.length === 1) return matches[0] as number;
  const names = entries.flatMap((entry) => entryName(entry) ?? []);
  const known =
    names.length === 0
      ? "it has no entries"
      : `its entries: ${names.join(", ")}`;
  const problem =
    matches.length === 0
      ? `No entry of ${section} is named "${name}"`
      : `Several entries of ${section} are named "${name}"`;
  throw new CreatureEntryError(`${problem}; ${known}.`);
}

/** The section's entries after remove, then replace, then add. */
function applySectionChanges(
  base: unknown,
  section: string,
  changes: CreatureSectionChanges,
): unknown[] {
  const entries: unknown[] = Array.isArray(base) ? [...base] : [];
  for (const name of changes.remove ?? [])
    entries.splice(findEntry(entries, section, name), 1);
  for (const entry of changes.replace ?? [])
    entries[findEntry(entries, section, entry.name)] = copyData(entry);
  for (const entry of changes.add ?? []) entries.push(copyData(entry));
  return entries;
}

/** The message every refused statblock opens with, then one line per problem. */
function invalidCreature(lines: readonly string[]): InvalidCreatureError {
  return new InvalidCreatureError(
    ["The statblock is not valid; nothing was saved:", ...lines].join("\n"),
  );
}

/** The hp a change gives: without an average, the one the dice give. */
function changedHp(hp: NonNullable<CreatureChanges["hp"]>): {
  dice: string;
  average: number;
} {
  if (hp.average !== undefined) return { dice: hp.dice, average: hp.average };
  try {
    return { dice: hp.dice, average: average(parseDice(hp.dice)) };
  } catch (e) {
    if (!(e instanceof DiceParseError)) throw e;
    throw invalidCreature([`hp.dice: ${e.message}`]);
  }
}

const SCALARS = [
  "name",
  "size",
  "type",
  "alignment",
  "ac",
  "armorDetail",
  "cr",
  "languages",
  "initiativeModifier",
] as const;

const MERGED = ["abilities", "saves", "speeds", "senses", "skills"] as const;

const LISTS = [
  "damageVulnerabilities",
  "damageResistances",
  "damageImmunities",
  "conditionImmunities",
] as const;

/** A new draft: base with changes applied; base is not changed. Throws CreatureEntryError, or InvalidCreatureError for hp dice that do not parse. Engine-internal. */
export function applyCreatureChanges(
  base: CreatureDraft,
  changes: CreatureChanges,
): CreatureDraft {
  const draft = copyData(base);
  for (const field of SCALARS) {
    const value = changes[field];
    if (value !== undefined)
      draft[field] =
        typeof value === "string" && field === "name" ? value.trim() : value;
  }
  if (changes.hp !== undefined) draft.hp = changedHp(changes.hp);
  for (const field of MERGED) {
    const value = changes[field];
    if (value !== undefined) draft[field] = mergeByKey(draft[field], value);
  }
  for (const field of LISTS) {
    const value = changes[field];
    if (value !== undefined) draft[field] = [...value];
  }
  if (changes.sections !== undefined) {
    const sections: Record<string, unknown> = isRecord(draft.sections)
      ? { ...draft.sections }
      : {};
    for (const section of SECTION_KEYS) {
      const sectionChanges = changes.sections[section];
      if (sectionChanges !== undefined)
        sections[section] = applySectionChanges(
          sections[section],
          section,
          sectionChanges,
        );
    }
    draft.sections = sections;
  }
  return draft;
}

/** One issue's path: keys joined by dots, indices in brackets, a section entry's index followed by its name. */
function issuePath(path: readonly PropertyKey[], draft: CreatureDraft): string {
  let text = "";
  let at: unknown = draft;
  path.forEach((segment, depth) => {
    at =
      isRecord(at) || Array.isArray(at)
        ? (at as Record<PropertyKey, unknown>)[segment]
        : undefined;
    if (typeof segment === "number") {
      text += `[${String(segment)}]`;
      const name = path[0] === "sections" && depth === 2 ? entryName(at) : "";
      if (name) text += ` (${name})`;
    } else {
      text += `${text === "" ? "" : "."}${String(segment)}`;
    }
  });
  return text === "" ? "statblock" : text;
}

const draftSchema = monsterSchema.omit({ key: true });

/** The draft validated by monsterSchema without its key; throws InvalidCreatureError naming every failing field. Engine-internal. */
export function parseCreatureDraft(draft: CreatureDraft): Omit<Monster, "key"> {
  const result = draftSchema.safeParse(draft);
  if (result.success) return result.data;
  throw invalidCreature(
    result.error.issues.map(
      (issue) => `${issuePath(issue.path, draft)}: ${issue.message}`,
    ),
  );
}

/** The InvalidCreatureError for a name with no letter or digit, which gives no key. Engine-internal. */
export function nameWithoutKeyError(): InvalidCreatureError {
  return invalidCreature(["name: must contain a letter or digit"]);
}

/** `<book>_<slug of name>`, or undefined when the name has no letter or digit. Engine-internal. */
export function creatureKey(book: string, name: string): string | undefined {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? undefined : `${book}_${slug}`;
}

/** Throws CreatureNameTakenError (naming edit_creature) when a creature of book has name, ignoring case; the creature with `exceptKey` does not count as a holder. Engine-internal. */
export function assertCreatureNameFree(
  monsters: MonsterIndex,
  book: string,
  name: string,
  exceptKey?: string,
): void {
  void exceptKey;
  const wanted = name.toLowerCase();
  const holder = monsters
    .list()
    .find((m) => m.source.book === book && m.name.toLowerCase() === wanted);
  if (holder)
    throw new CreatureNameTakenError(
      `${book} already has a creature named "${holder.name}" (${holder.key}). Change it with edit_creature, or pick another name.`,
    );
}
